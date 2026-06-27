'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireRole, getSessionUser } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { logSecurityEvent } from '@/lib/security';
import { IMPERSONATION_COOKIE } from '@/lib/impersonation';

const startSchema = z.object({
  companyId: z.string().uuid(),
  reason: z.string().min(8, 'Reason is required and must be specific.').max(500),
  durationMinutes: z.coerce.number().int().min(5).max(120).default(60),
});

export async function startImpersonationAction(formData: FormData): Promise<void> {
  const admin = await requireRole([ROLES.SUPER_ADMIN]);
  const parsed = startSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
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
  if (error || !session) return;

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

  redirect('/company');
}

export async function endImpersonationAction(): Promise<void> {
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
    redirect(companyId ? `/super-admin/companies/${companyId}` : '/super-admin');
  }
  redirect('/super-admin');
}
