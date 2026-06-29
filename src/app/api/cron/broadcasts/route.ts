import { createSupabaseServiceClient } from '@/lib/db/server';
import { decryptSecret } from '@/lib/crypto';
import { sendWhatsAppText, type WhatsAppRoute } from '@/lib/channels/whatsapp';
import { sendChannelEmail } from '@/lib/channels/email';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_PER_RUN = 1000;

/**
 * Broadcast dispatcher. Sends due scheduled broadcasts to the lead list over the
 * company's connected channel. Protect with CRON_SECRET and call on a schedule.
 *
 * Note: WhatsApp free-form sends only reach contacts inside the 24h service
 * window; cold outreach needs an approved template (a follow-up enhancement).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return json({ error: 'cron_not_configured' }, 503);
  const provided = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (provided !== secret) return json({ error: 'unauthorized' }, 401);

  const sb = createSupabaseServiceClient();
  const nowIso = new Date().toISOString();
  const { data: due } = await sb
    .from('broadcasts')
    .select('id,company_id,channel,subject,message,schedule_at')
    .eq('status', 'scheduled')
    .or(`schedule_at.is.null,schedule_at.lte.${nowIso}`)
    .limit(20);

  let processed = 0;
  for (const row of due ?? []) {
    const b = row as Record<string, unknown>;
    const id = b.id as string;
    const companyId = b.company_id as string;
    await sb.from('broadcasts').update({ status: 'sending' }).eq('id', id);

    try {
      const sent = await dispatch(sb, {
        companyId,
        channel: b.channel as string,
        subject: (b.subject as string) ?? null,
        message: b.message as string,
      });
      await sb
        .from('broadcasts')
        .update({ status: 'sent', sent_count: sent, sent_at: new Date().toISOString(), error: null })
        .eq('id', id);
      processed += sent;
    } catch (err) {
      await sb
        .from('broadcasts')
        .update({ status: 'failed', error: err instanceof Error ? err.message : 'dispatch failed' })
        .eq('id', id);
    }
  }

  return json({ ok: true, broadcasts: (due ?? []).length, recipients: processed }, 200);
}

async function dispatch(
  sb: ReturnType<typeof createSupabaseServiceClient>,
  b: { companyId: string; channel: string; subject: string | null; message: string },
): Promise<number> {
  const { data: identityRow } = await sb
    .from('channel_identities')
    .select('external_id,secret_encrypted')
    .eq('company_id', b.companyId)
    .eq('channel', b.channel)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (!identityRow) throw new Error(`No active ${b.channel} channel connected`);
  const identity = identityRow as { external_id: string; secret_encrypted: string | null };

  if (b.channel === 'whatsapp') {
    let token: string | null = null;
    try {
      token = identity.secret_encrypted ? decryptSecret(identity.secret_encrypted) : null;
    } catch {
      token = identity.secret_encrypted;
    }
    if (!token) throw new Error('WhatsApp token missing');
    const route: WhatsAppRoute = {
      companyId: b.companyId,
      provider: 'meta_cloud',
      metaToken: token,
      metaPhoneNumberId: identity.external_id,
    };
    const { data: leads } = await sb
      .from('leads')
      .select('phone')
      .eq('company_id', b.companyId)
      .not('phone', 'is', null)
      .limit(MAX_PER_RUN);
    let sent = 0;
    for (const lead of leads ?? []) {
      const phone = (lead as { phone: string }).phone;
      if (phone && (await sendWhatsAppText(route, phone, b.message))) sent++;
    }
    return sent;
  }

  // email
  const { data: leads } = await sb
    .from('leads')
    .select('email')
    .eq('company_id', b.companyId)
    .not('email', 'is', null)
    .limit(MAX_PER_RUN);
  let sent = 0;
  for (const lead of leads ?? []) {
    const email = (lead as { email: string }).email;
    if (email && (await sendChannelEmail({ to: email, from: identity.external_id, subject: b.subject ?? 'Update', text: b.message }))) {
      sent++;
    }
  }
  if (sent === 0) logger.warn('Email broadcast sent 0 (configure EMAIL_API_URL)', { companyId: b.companyId });
  return sent;
}

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
