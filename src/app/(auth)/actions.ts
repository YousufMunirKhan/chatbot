'use server';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/db/server';
import { getSessionUser, homePathFor } from '@/lib/auth';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { hashSecurityCode, logSecurityEvent, sendTwoFactorCode } from '@/lib/security';
import { IMPERSONATION_COOKIE } from '@/lib/impersonation';
import { env } from '@/lib/env';

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
