import { createSupabaseServiceClient } from '@/lib/db/server';
import { decryptSecret } from '@/lib/crypto';
import { sendWhatsAppText, type WhatsAppRoute, normalizeWhatsAppNumber } from '@/lib/channels/whatsapp';
import { sendWhatsAppTemplate } from '@/lib/channels/whatsapp-templates';
import { sendChannelEmail } from '@/lib/channels/email';
import { resolveAudience, type AudienceContact, type AudienceFilter } from '@/lib/channels/broadcast-audience';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_PER_RUN = 1000;

interface BroadcastJob {
  companyId: string;
  channel: string;
  subject: string | null;
  message: string;
  audience: string;
  audienceFilter: AudienceFilter;
  templateName: string | null;
  templateLanguage: string;
  templateVariables: string[];
  channelIdentityId: string | null;
}

/**
 * Broadcast dispatcher. Sends due scheduled broadcasts over the company's
 * connected channel. Protect with CRON_SECRET and call on a schedule.
 *
 * Two things make a broadcast actually deliverable, and both are handled here:
 * consent (an opted-out contact is never messaged, whatever the audience says)
 * and the 24h service window — outside it WhatsApp only accepts an approved
 * template, so a broadcast carrying `template_name` sends as a template and one
 * without it falls back to a session text.
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
    .select(
      'id,company_id,channel,subject,message,schedule_at,audience,audience_filter,template_name,template_language,template_variables,channel_identity_id',
    )
    .eq('status', 'scheduled')
    .or(`schedule_at.is.null,schedule_at.lte.${nowIso}`)
    .limit(20);

  let processed = 0;
  let failedTotal = 0;
  for (const row of due ?? []) {
    const b = row as Record<string, unknown>;
    const id = b.id as string;
    await sb.from('broadcasts').update({ status: 'sending' }).eq('id', id);

    try {
      const result = await dispatch(sb, {
        companyId: b.company_id as string,
        channel: b.channel as string,
        subject: (b.subject as string) ?? null,
        message: b.message as string,
        audience: (b.audience as string) ?? 'all_leads',
        audienceFilter: ((b.audience_filter as AudienceFilter) ?? {}) as AudienceFilter,
        templateName: (b.template_name as string) ?? null,
        templateLanguage: (b.template_language as string) ?? 'en_US',
        templateVariables: Array.isArray(b.template_variables)
          ? (b.template_variables as unknown[]).map((v) => String(v ?? ''))
          : [],
        channelIdentityId: (b.channel_identity_id as string) ?? null,
      });
      await sb
        .from('broadcasts')
        .update({
          status: 'sent',
          sent_count: result.sent,
          failed_count: result.failed,
          sent_at: new Date().toISOString(),
          error: null,
        })
        .eq('id', id);
      processed += result.sent;
      failedTotal += result.failed;
    } catch (err) {
      await sb
        .from('broadcasts')
        .update({ status: 'failed', error: err instanceof Error ? err.message : 'dispatch failed' })
        .eq('id', id);
    }
  }

  return json({ ok: true, broadcasts: (due ?? []).length, recipients: processed, failed: failedTotal }, 200);
}

type Db = ReturnType<typeof createSupabaseServiceClient>;

/**
 * Build the candidate contact list for a company on one channel.
 *
 * Leads carry no tags of their own, so tag targeting reads the tags an agent
 * put on the customer's conversation — the only place tagging exists today.
 */
async function loadContacts(sb: Db, companyId: string, channel: string): Promise<AudienceContact[]> {
  const field = channel === 'email' ? 'email' : 'phone';
  const { data: leads } = await sb
    .from('leads')
    .select(`id,${field},status,conversation_id`)
    .eq('company_id', companyId)
    .not(field, 'is', null)
    .limit(MAX_PER_RUN);

  const rows = (leads ?? []) as Array<Record<string, unknown>>;
  const conversationIds = rows.map((r) => r.conversation_id as string | null).filter(Boolean) as string[];

  const tagsByConversation = new Map<string, string[]>();
  if (conversationIds.length) {
    const { data: convs } = await sb
      .from('conversations')
      .select('id,tags')
      // TENANT ISOLATION: never widen a tag lookup past the owning company.
      .eq('company_id', companyId)
      .in('id', conversationIds.slice(0, MAX_PER_RUN));
    for (const c of convs ?? []) {
      const x = c as { id: string; tags: string[] | null };
      tagsByConversation.set(x.id, x.tags ?? []);
    }
  }

  return rows
    .map((r) => {
      const raw = String(r[field] ?? '').trim();
      const identifier = channel === 'email' ? raw.toLowerCase() : normalizeWhatsAppNumber(raw);
      const conversationId = r.conversation_id as string | null;
      return {
        identifier,
        status: (r.status as string) ?? null,
        tags: conversationId ? tagsByConversation.get(conversationId) ?? [] : [],
      };
    })
    .filter((c) => Boolean(c.identifier));
}

/** Contacts this company has explicitly opted in / out of a channel. */
async function loadConsent(
  sb: Db,
  companyId: string,
  channel: string,
): Promise<{ optedIn: Set<string>; optedOut: Set<string> }> {
  const { data } = await sb
    .from('contact_subscriptions')
    .select('contact_identifier,opted_in')
    .eq('company_id', companyId)
    .eq('channel', channel)
    .limit(50000);
  const optedIn = new Set<string>();
  const optedOut = new Set<string>();
  for (const r of data ?? []) {
    const x = r as { contact_identifier: string; opted_in: boolean };
    if (x.opted_in === false) optedOut.add(x.contact_identifier);
    else optedIn.add(x.contact_identifier);
  }
  return { optedIn, optedOut };
}

async function dispatch(sb: Db, b: BroadcastJob): Promise<{ sent: number; failed: number }> {
  let identityQuery = sb
    .from('channel_identities')
    .select('id,external_id,secret_encrypted')
    // TENANT ISOLATION: the identity must belong to the broadcasting company.
    .eq('company_id', b.companyId)
    .eq('channel', b.channel)
    .eq('is_active', true);
  if (b.channelIdentityId) identityQuery = identityQuery.eq('id', b.channelIdentityId);

  const { data: identityRow } = await identityQuery.limit(1).maybeSingle();
  if (!identityRow) throw new Error(`No active ${b.channel} channel connected`);
  const identity = identityRow as { external_id: string; secret_encrypted: string | null };

  const [contacts, consent] = await Promise.all([
    loadContacts(sb, b.companyId, b.channel),
    loadConsent(sb, b.companyId, b.channel),
  ]);

  const recipients = resolveAudience(
    contacts,
    { audience: b.audience, filter: b.audienceFilter },
    { optedIn: consent.optedIn, optedOut: consent.optedOut },
  );
  if (recipients.length === 0) {
    logger.warn('Broadcast resolved to zero recipients', {
      companyId: b.companyId,
      audience: b.audience,
      channel: b.channel,
    });
    return { sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;

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

    for (const to of recipients) {
      // A template is the only message WhatsApp accepts outside the 24h service
      // window, so a broadcast that names one always sends as a template.
      const ok = b.templateName
        ? await sendWhatsAppTemplate(
            token,
            identity.external_id,
            to,
            b.templateName,
            b.templateLanguage,
            b.templateVariables,
          )
        : await sendWhatsAppText(route, to, b.message);
      if (ok) sent++;
      else failed++;
    }
    return { sent, failed };
  }

  // email
  for (const to of recipients) {
    const ok = await sendChannelEmail({
      to,
      from: identity.external_id,
      subject: b.subject ?? 'Update',
      text: b.message,
    });
    if (ok) sent++;
    else failed++;
  }
  if (sent === 0) logger.warn('Email broadcast sent 0 (configure EMAIL_API_URL)', { companyId: b.companyId });
  return { sent, failed };
}

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
