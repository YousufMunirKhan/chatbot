'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { cookies, headers } from 'next/headers';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/db/server';
import { getSessionUser, homePathFor } from '@/lib/auth';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { hashSecurityCode, logSecurityEvent, sendTwoFactorCode } from '@/lib/security';
import { IMPERSONATION_COOKIE } from '@/lib/impersonation';
import { rateLimitDistributed } from '@/lib/ratelimit';
import { env } from '@/lib/env';
import { provisionCompany } from '@/modules/onboarding/provision';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type LoginState = { error?: string };

/** Email/password sign-in. On success, redirect to the user's role home. */
export async function signInAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) return { error: 'Please enter a valid email and password.' };

  const supabase = createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: error.message };

  const user = await getSessionUser({ skipTwoFactorCheck: true });
  if (user) {
    const sb = createSupabaseServiceClient();
    const { data: security } = await sb
      .from('user_security_settings')
      .select('two_factor_enabled')
      .eq('user_id', user.userId)
      .maybeSingle();
    await logSecurityEvent({ userId: user.userId, companyId: user.companyId, eventType: 'login.password_success' });
    if (security?.two_factor_enabled) {
      await sendTwoFactorCode(user.userId, user.email);
      redirect('/login/2fa');
    }
    await sb.from('user_security_settings').upsert(
      {
        user_id: user.userId,
        last_login_at: new Date().toISOString(),
        two_factor_verified_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
  }
  redirect(user ? homePathFor(user) : '/dashboard');
}

const signUpSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name.').max(120, 'That name is too long.'),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Enter a valid work email address.')
    .max(254, 'That email address is too long.'),
  // The upper bound is GoTrue's, not ours: it hashes with bcrypt, which reads
  // only the first 72 bytes and rejects anything longer outright. Catching it
  // here turns a raw auth error into a sentence about the field they typed in.
  password: z
    .string()
    .min(8, 'Choose a password of at least 8 characters.')
    .max(72, 'Choose a password of 72 characters or fewer.'),
  companyName: z
    .string()
    .trim()
    .min(2, 'Enter your business name.')
    .max(120, 'That business name is too long.'),
});

export type SignUpState = { error?: string };

/**
 * Self-serve signup: account, company, free trial, and straight into the
 * dashboard.
 *
 * Everything that makes the tenant lives in `provisionCompany`, which runs the
 * same sequence as super-admin onboarding and unwinds itself if any step fails,
 * so this action is only the two things that are specific to a stranger doing
 * it themselves: throttling, and turning the new credentials into a session.
 */
export async function signUpAction(_prev: SignUpState, formData: FormData): Promise<SignUpState> {
  const parsed = signUpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  const v = parsed.data;

  // This is the only unauthenticated endpoint in the product that writes a
  // company, a subscription, a credit wallet and an auth user, so it is
  // throttled on both axes that matter. The address limit stops one script
  // opening tenants in bulk; the email limit stops the form being used to probe
  // which addresses already have accounts, which the "already has an account"
  // message would otherwise answer as fast as it could be asked.
  const requestHeaders = headers();
  const ip =
    requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    requestHeaders.get('x-real-ip') ??
    'unknown';
  const hour = 60 * 60 * 1000;
  const [byAddress, byEmail] = await Promise.all([
    rateLimitDistributed(`signup:ip:${ip}`, 5, hour),
    rateLimitDistributed(`signup:email:${v.email}`, 5, hour),
  ]);
  if (!byAddress.ok || !byEmail.ok) {
    return {
      error: 'Too many sign-up attempts from this connection. Wait an hour and try again, or contact support if you are stuck.',
    };
  }

  const provisioned = await provisionCompany({
    companyName: v.companyName,
    plan: 'free_trial',
    signupSource: 'self_serve',
    adminEmail: v.email,
    adminPassword: v.password,
    adminName: v.name,
    auditAction: 'company.self_serve_signup',
    auditMetadata: { signupIp: ip },
  });
  if (!provisioned.ok) return { error: provisioned.error };

  // Signing in with the credentials they just chose, rather than minting a
  // session by hand, because this is the one path that writes the auth cookies
  // every server component in the app reads.
  const supabase = createSupabaseServerClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: v.email,
    password: v.password,
  });
  if (signInError) {
    // The account is complete and correct; only the session failed. Deleting it
    // to keep this function tidy would throw away a working account, so the
    // message sends them one step sideways instead.
    return {
      error: 'Your account is ready, but signing you in did not work. Please sign in with the email and password you just chose.',
    };
  }

  const sb = createSupabaseServiceClient();
  await sb.from('user_security_settings').upsert(
    {
      user_id: provisioned.userId,
      last_login_at: new Date().toISOString(),
      two_factor_verified_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  await logSecurityEvent({
    userId: provisioned.userId,
    companyId: provisioned.companyId,
    eventType: 'signup.self_serve',
    ip,
    userAgent: requestHeaders.get('user-agent'),
  });

  // The operator's company list is a cached server render, so without this the
  // new tenant is invisible to support until something unrelated writes.
  revalidatePath('/super-admin/companies');

  const user = await getSessionUser({ skipTwoFactorCheck: true });
  redirect(user ? homePathFor(user) : '/company');
}

const forgotPasswordSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
});

export type ForgotPasswordState = { error?: string; ok?: boolean };

export async function forgotPasswordAction(
  _prev: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const parsed = forgotPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Enter a valid email.' };

  const supabase = createSupabaseServerClient();
  const redirectTo = `${env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, '')}/auth/callback?next=/reset-password`;
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, { redirectTo });
  if (error) return { error: error.message };

  return { ok: true };
}

const resetPasswordSchema = z
  .object({
    password: z.string().min(8, 'Password must be at least 8 characters.'),
    confirmPassword: z.string().min(8, 'Confirm your password.'),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export type ResetPasswordState = { error?: string };

export async function resetPasswordAction(
  _prev: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const parsed = resetPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid password.' };

  const supabase = createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: error.message };

  redirect('/login');
}

const twoFactorSchema = z.object({ code: z.string().length(6) });

export type TwoFactorState = { error?: string };

export async function verifyTwoFactorAction(
  _prev: TwoFactorState,
  formData: FormData,
): Promise<TwoFactorState> {
  const parsed = twoFactorSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Enter the 6-digit code.' };
  const user = await getSessionUser({ skipTwoFactorCheck: true });
  if (!user) redirect('/login');
  const sb = createSupabaseServiceClient();
  const { data: security } = await sb
    .from('user_security_settings')
    .select('pending_code_hash,pending_expires_at')
    .eq('user_id', user.userId)
    .maybeSingle();
  const valid =
    security?.pending_code_hash === hashSecurityCode(parsed.data.code) &&
    security.pending_expires_at &&
    new Date(security.pending_expires_at).getTime() > Date.now();
  if (!valid) {
    await logSecurityEvent({ userId: user.userId, companyId: user.companyId, eventType: 'login.2fa_failed' });
    return { error: 'Invalid or expired code.' };
  }
  await sb
    .from('user_security_settings')
    .update({
      pending_code_hash: null,
      pending_expires_at: null,
      two_factor_verified_at: new Date().toISOString(),
      last_login_at: new Date().toISOString(),
    })
    .eq('user_id', user.userId);
  await logSecurityEvent({ userId: user.userId, companyId: user.companyId, eventType: 'login.2fa_success' });
  redirect(homePathFor(user));
}

/** Sign out and return to the login page. */
export async function signOutAction(): Promise<void> {
  const supabase = createSupabaseServerClient();
  cookies().delete(IMPERSONATION_COOKIE);
  await supabase.auth.signOut();
  redirect('/login');
}
