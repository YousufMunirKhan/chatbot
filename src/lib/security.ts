import crypto from 'node:crypto';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { sendEmail } from '@/lib/email';

export function hashSecurityCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

export function createSecurityCode(): string {
  return String(crypto.randomInt(100000, 1000000));
}

export function requestMeta(req?: Request): { ip?: string | null; userAgent?: string | null } {
  return {
    ip: req?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req?.headers.get('x-real-ip'),
    userAgent: req?.headers.get('user-agent'),
  };
}

export async function logSecurityEvent(params: {
  userId?: string | null;
  companyId?: string | null;
  eventType: string;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const sb = createSupabaseServiceClient();
  await sb.from('security_audit_logs').insert({
    user_id: params.userId ?? null,
    company_id: params.companyId ?? null,
    event_type: params.eventType,
    ip_address: params.ip ?? null,
    user_agent: params.userAgent ?? null,
    metadata_json: params.metadata ?? {},
  });
}

export async function sendTwoFactorCode(userId: string, email: string): Promise<void> {
  const code = createSecurityCode();
  const sb = createSupabaseServiceClient();
  await sb.from('user_security_settings').upsert(
    {
      user_id: userId,
      pending_code_hash: hashSecurityCode(code),
      pending_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    },
    { onConflict: 'user_id' },
  );
  await sendEmail({
    to: email,
    subject: 'Your login verification code',
    html: `<p>Your verification code is <strong>${code}</strong>.</p><p>It expires in 10 minutes.</p>`,
  });
}
