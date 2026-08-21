'use server';

import { cookies } from 'next/headers';
import { z } from 'zod';
import { requireRole, getSessionUser } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { logSecurityEvent } from '@/lib/security';
import { IMPERSONATION_COOKIE } from '@/lib/impersonation';

/**
 * Switching tenant identity must land as a full page load, not a soft
 * navigation. (dashboard)/layout.tsx renders the brand, nav and impersonation
 * banner, and Next never re-executes a layout on a client-side navigation — so
 * a redirect() here would leave the previous company's shell on screen. These
 * actions therefore hand the target back to the caller, which assigns
 * window.location. That also drops every client cache holding the old tenant's
 * data, which is what we want when identity changes.
 */
export type ImpersonationState = { error?: string; redirectTo?: string };

const startSchema = z.object({
  companyId: z.string().uuid(),
  reason: z.string().min(8, 'Reason is required and must be specific.').max(500),
  durationMinutes: z.coerce.number().int().min(5).max(120).default(60),
});

export async function startImpersonationAction(
  _prev: ImpersonationState,
  formData: FormData,
): Promise<ImpersonationState> {
  const admin = await requireRole([ROLES.SUPER_ADMIN]);
  const parsed = startSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid request.' };
  const v = parsed.data;
  const sb = createSupabaseServiceClient();
  const expiresAt = new Date(Date.now() + v.durationMinutes * 60_000).toISOString();

  const { data: session, error } = await sb
    .from('super_admin_impersonation_sessions')
    .insert({
      super_admin_id: admin.userId,
      company_id: v.companyId,
      reason: v.reason,
      expires_at: expiresAt,
    })
    .select('id')
    .single();
  if (error || !session) return { error: error?.message ?? 'Could not start impersonation.' };

  cookies().set(IMPERSONATION_COOKIE, session.id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: v.durationMinutes * 60,
  });

  await Promise.all([
    sb.from('admin_access_logs').insert({
      super_admin_id: admin.userId,
      company_id: v.companyId,
      action: 'impersonation.started',
      target_type: 'company',
      target_id: v.companyId,
    }),
    sb.from('audit_logs').insert({
      company_id: v.companyId,
      actor_user_id: admin.userId,
      action: 'super_admin.impersonation_started',
      target_type: 'company',
      target_id: v.companyId,
      metadata_json: { reason: v.reason, durationMinutes: v.durationMinutes, sessionId: session.id },
    }),
    logSecurityEvent({
      userId: admin.userId,
      companyId: v.companyId,
      eventType: 'impersonation.started',
      metadata: { reason: v.reason, durationMinutes: v.durationMinutes, sessionId: session.id },
    }),
  ]);

  return { redirectTo: '/company' };
}

export async function endImpersonationAction(
  _prev: ImpersonationState,
  _formData: FormData,
): Promise<ImpersonationState> {
  const user = await getSessionUser({ skipTwoFactorCheck: true });
  const sessionId = cookies().get(IMPERSONATION_COOKIE)?.value;
  cookies().delete(IMPERSONATION_COOKIE);
  if (user?.isSuperAdmin && sessionId) {
    const sb = createSupabaseServiceClient();
    const { data: session } = await sb
      .from('super_admin_impersonation_sessions')
      .update({ ended_at: new Date().toISOString() })
      .eq('id', sessionId)
      .eq('super_admin_id', user.userId)
      .select('company_id')
      .maybeSingle();
    const companyId = (session?.company_id as string | undefined) ?? user.companyId ?? null;
    await Promise.all([
      companyId
        ? sb.from('admin_access_logs').insert({
            super_admin_id: user.userId,
            company_id: companyId,
            action: 'impersonation.ended',
            target_type: 'company',
            target_id: companyId,
          })
        : Promise.resolve(),
      logSecurityEvent({
        userId: user.userId,
        companyId,
        eventType: 'impersonation.ended',
        metadata: { sessionId },
      }),
    ]);
    return { redirectTo: companyId ? `/super-admin/companies/${companyId}` : '/super-admin' };
  }
  return { redirectTo: '/super-admin' };
}
