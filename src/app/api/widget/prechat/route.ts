import { z } from 'zod';
import {
  detectLanguage,
  getOrCreateConversation,
  isOriginAllowed,
  loadBotByPublicId,
  saveMessage,
} from '@/lib/ai/engine';
import { isCompanyOpenNow } from '@/lib/business-hours';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { notify } from '@/lib/notify';
import { formatActionSubmission } from '@/lib/quick-actions-format';
import { loadWidgetPrechatSettings } from '../prechat-settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Contact capture for the two moments the widget can now ask for details: the
 * pre-chat form shown before the first message, and the out-of-hours "leave a
 * message" form shown when `isCompanyOpenNow()` says the company is closed.
 *
 * Both land in `leads`, the same table the quick-action forms write to, so the
 * company reads one list instead of hunting through three. The details are also
 * written into the transcript as a system message, because an agent opening the
 * conversation in the inbox should not have to leave it to find out who they
 * are talking to.
 *
 * Guards mirror the other public widget endpoints (see /api/widget/csat).
 */

const bodySchema = z.object({
  publicBotId: z.string().min(1),
  visitorId: z.string().min(1).max(100),
  conversationId: z.string().uuid().optional(),
  mode: z.enum(['prechat', 'offline']),
  name: z.string().trim().max(120).optional(),
  email: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(60).optional(),
  message: z.string().trim().max(2000).optional(),
  pageUrl: z.string().max(2000).optional(),
});

function cors(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(obj: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store, max-age=0' },
  });
}

function clean(value: string | undefined): string | null {
  return value && value.trim() ? value.trim() : null;
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: cors(req.headers.get('origin')) });
}

export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  const headers = cors(origin);
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return json({ error: 'invalid_request' }, 400, headers);
  }

  const bot = await loadBotByPublicId(body.publicBotId);
  if (!bot) return json({ error: 'bot_not_found' }, 404, headers);
  if (bot.assistantAudience === 'internal') {
    return json({ error: 'internal_assistant_not_available_on_widget' }, 403, headers);
  }
  if (!isOriginAllowed(bot.domainAllowlist, origin)) {
    return json({ error: 'domain_not_allowed' }, 403, headers);
  }

  const settings = await loadWidgetPrechatSettings(bot.companyId);
  const name = clean(body.name);
  const email = clean(body.email);
  const phone = clean(body.phone);
  const message = clean(body.message);

  // The browser decides which inputs to draw; the server decides what counts as
  // a valid submission. A page that strips the `required` attributes, or a stale
  // widget cached from before the settings changed, must not be able to post an
  // empty lead past a gate the company turned on.
  if (body.mode === 'prechat') {
    if (!settings.prechatEnabled) return json({ error: 'prechat_disabled' }, 400, headers);
    if (settings.prechatRequired) {
      const missing: string[] = [];
      if (settings.prechatAskName && !name) missing.push('name');
      if (settings.prechatAskEmail && !email) missing.push('email');
      if (settings.prechatAskPhone && !phone) missing.push('phone');
      if (missing.length) return json({ error: 'missing_fields', fields: missing }, 400, headers);
    }
  } else if (!settings.offlineEnabled || !settings.offlineFormEnabled) {
    return json({ error: 'offline_form_disabled' }, 400, headers);
  }

  if (email && !looksLikeEmail(email)) return json({ error: 'invalid_email' }, 400, headers);
  if (body.mode === 'offline' && !name && !email && !phone && !message) {
    return json({ error: 'missing_fields', fields: ['message'] }, 400, headers);
  }

  const language = detectLanguage([name, message].filter(Boolean).join(' ') || 'hello');
  const convo = await getOrCreateConversation({
    companyId: bot.companyId,
    botId: bot.id,
    conversationId: body.conversationId,
    visitorId: body.visitorId,
    language,
  });

  const sb = createSupabaseServiceClient();
  const isOffline = body.mode === 'offline';
  const { data: lead } = await sb
    .from('leads')
    .insert({
      company_id: bot.companyId,
      bot_id: bot.id,
      conversation_id: convo.id,
      name,
      email,
      phone,
      enquiry_type: isOffline ? 'Out-of-hours message' : 'Pre-chat form',
      message,
      source_page: body.pageUrl ?? null,
      source: isOffline ? 'widget_offline' : 'widget_prechat',
      status: 'new',
    })
    .select('id')
    .maybeSingle();

  const label = isOffline ? 'Message left out of hours' : 'Pre-chat details';
  const summary = formatActionSubmission(label, { name, email, phone, message });

  // Written as the visitor's own message, the same way a submitted quick-action
  // form is: an agent opening the conversation reads it in place, and the
  // widget replays it as the visitor's bubble after a reload without needing to
  // know anything special about pre-chat.
  await saveMessage({
    companyId: bot.companyId,
    conversationId: convo.id,
    senderType: 'visitor',
    senderId: body.visitorId,
    text: summary,
    language,
    bumpUnread: true,
  });

  if (isOffline) {
    // Flag it for a person without disabling the assistant. Nobody is going to
    // answer until the company reopens, and a visitor who has just been told
    // that is exactly the one who still wants the bot to answer the question
    // they came with.
    await sb
      .from('conversations')
      .update({ status: 'needs_human', last_message_at: new Date().toISOString() })
      .eq('company_id', bot.companyId)
      .eq('id', convo.id);
  }

  await notify({
    companyId: bot.companyId,
    type: 'new_lead',
    title: isOffline ? 'Message left out of hours' : 'New pre-chat lead',
    body:
      [name, email, phone, message].filter(Boolean).join(' · ') ||
      'Website visitor left their details',
    data: { leadId: lead?.id ?? null, conversationId: convo.id, source: isOffline ? 'widget_offline' : 'widget_prechat' },
    email: true,
  });

  const stillClosed = isOffline ? await isCompanyOpenNow(bot.companyId) : null;

  return json(
    {
      ok: true,
      conversationId: convo.id,
      isOpenNow: stillClosed,
      message: isOffline
        ? 'Thanks. We have your message and will reply as soon as we are back.'
        : 'Thanks. How can we help?',
    },
    200,
    headers,
  );
}
