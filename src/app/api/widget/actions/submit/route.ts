import { z } from 'zod';
import {
  detectLanguage,
  getOrCreateConversation,
  isOriginAllowed,
  loadBotByPublicId,
  saveMessage,
} from '@/lib/ai/engine';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { notify } from '@/lib/notify';
import { mapQuickAction } from '@/lib/quick-actions';
import { createGoogleCalendarEventForAppointment } from '@/lib/integrations/google-calendar';
import { assignBestAvailableAgent } from '@/lib/agent-routing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  publicBotId: z.string().min(1),
  visitorId: z.string().min(1).max(100),
  conversationId: z.string().uuid().optional(),
  actionId: z.string().uuid(),
  pageUrl: z.string().optional(),
  formValues: z.record(z.string(), z.unknown()).default({}),
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
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

function textValue(values: Record<string, unknown>, names: string[]): string | null {
  for (const name of names) {
    const v = values[name];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function dateValue(values: Record<string, unknown>, names: string[]): string | null {
  const v = textValue(values, names);
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
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
  if (bot.assistantAudience === 'internal') return json({ error: 'internal_assistant_not_available_on_widget' }, 403, headers);
  if (!isOriginAllowed(bot.domainAllowlist, origin)) return json({ error: 'domain_not_allowed' }, 403, headers);

  const sb = createSupabaseServiceClient();
  const { data: row } = await sb
    .from('bot_quick_actions')
    .select('*')
    .eq('company_id', bot.companyId)
    .eq('id', body.actionId)
    .eq('is_active', true)
    .or(`bot_id.eq.${bot.id},bot_id.is.null`)
    .maybeSingle();
  if (!row) return json({ error: 'action_not_found' }, 404, headers);

  const action = mapQuickAction(row as Record<string, unknown>);
  const language = detectLanguage(JSON.stringify(body.formValues));
  const convo = await getOrCreateConversation({
    companyId: bot.companyId,
    botId: bot.id,
    conversationId: body.conversationId,
    visitorId: body.visitorId,
    language,
  });

  await sb.from('quick_action_clicks').insert({
    company_id: bot.companyId,
    bot_id: bot.id,
    quick_action_id: action.id,
    conversation_id: convo.id,
    visitor_id: body.visitorId,
    action_type: action.actionType,
    metadata_json: { pageUrl: body.pageUrl ?? null },
  });

  if (action.actionType === 'lead_form') {
    const name = textValue(body.formValues, ['name', 'full_name', 'fullName']);
    const email = textValue(body.formValues, ['email']);
    const phone = textValue(body.formValues, ['phone', 'mobile']);
    const message = textValue(body.formValues, ['message', 'notes', 'enquiry']);
    const { data: lead } = await sb
      .from('leads')
      .insert({
        company_id: bot.companyId,
        bot_id: bot.id,
        conversation_id: convo.id,
        name,
        email,
        phone,
        enquiry_type: (action.config.enquiry_type as string) ?? action.label,
        message,
        source_page: body.pageUrl ?? null,
        source: 'quick_action',
        status: 'new',
      })
      .select('id')
      .maybeSingle();
    await saveMessage({
      companyId: bot.companyId,
      conversationId: convo.id,
      senderType: 'visitor',
      senderId: body.visitorId,
      text: `${action.label}: ${JSON.stringify(body.formValues)}`,
      language,
      bumpUnread: true,
    });
    await notify({
      companyId: bot.companyId,
      type: 'new_lead',
      title: 'New lead from quick action',
      body: `${name ?? 'Visitor'} submitted ${action.label}`,
      data: { leadId: lead?.id ?? null, actionId: action.id },
      email: true,
    });
    await sb.from('quick_action_clicks').update({ completed_at: new Date().toISOString() }).eq('quick_action_id', action.id).eq('conversation_id', convo.id);
    return json({ ok: true, conversationId: convo.id, message: 'Thanks. Your details were sent.' }, 200, headers);
  }

  if (action.actionType === 'appointment_form') {
    const name = textValue(body.formValues, ['name', 'full_name', 'fullName']);
    const email = textValue(body.formValues, ['email']);
    const phone = textValue(body.formValues, ['phone', 'mobile']);
    const service = textValue(body.formValues, ['service', 'service_type', 'serviceType']);
    const preferredDate = dateValue(body.formValues, ['date', 'preferred_date', 'preferredDate']);
    const preferredTime = textValue(body.formValues, ['time', 'preferred_time', 'preferredTime']);
    const notes = textValue(body.formValues, ['notes', 'message']);
    const { data: appointment } = await sb
      .from('appointments')
      .insert({
        company_id: bot.companyId,
        bot_id: bot.id,
        conversation_id: convo.id,
        customer_name: name,
        customer_phone: phone,
        customer_email: email,
        service_type: service ?? (action.config.service_type as string) ?? action.label,
        preferred_date: preferredDate,
        preferred_time: preferredTime,
        notes,
        status: 'requested',
      })
      .select('id')
      .maybeSingle();
    if (appointment?.id) {
      await createGoogleCalendarEventForAppointment({
        companyId: bot.companyId,
        appointmentId: appointment.id,
        summary: `${service ?? action.label} - ${name ?? 'Website visitor'}`,
        description: notes,
        preferredDate,
        preferredTime,
        attendeeEmail: email,
      });
    }
    await saveMessage({
      companyId: bot.companyId,
      conversationId: convo.id,
      senderType: 'visitor',
      senderId: body.visitorId,
      text: `${action.label}: ${JSON.stringify(body.formValues)}`,
      language,
      bumpUnread: true,
    });
    await notify({
      companyId: bot.companyId,
      type: 'new_appointment',
      title: 'New appointment request',
      body: `${name ?? 'Visitor'} requested ${service ?? action.label}`,
      data: { appointmentId: appointment?.id ?? null, actionId: action.id },
      email: true,
    });
    await sb.from('quick_action_clicks').update({ completed_at: new Date().toISOString() }).eq('quick_action_id', action.id).eq('conversation_id', convo.id);
    return json({ ok: true, conversationId: convo.id, message: 'Thanks. Your appointment request was sent.' }, 200, headers);
  }

  if (action.actionType === 'request_human') {
    // Capture any contact details the visitor left so the team can follow up
    // even if no agent is online right now (doc §5).
    const name = textValue(body.formValues, ['name', 'full_name', 'fullName']);
    const contact = textValue(body.formValues, ['contact', 'phone', 'email', 'mobile']);
    const note = textValue(body.formValues, ['message', 'notes', 'enquiry']);
    const summary = [
      name ? `Name: ${name}` : null,
      contact ? `Contact: ${contact}` : null,
      note ? `Message: ${note}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    await sb
      .from('conversations')
      .update({ ai_enabled: false, status: 'needs_human', last_message_at: new Date().toISOString() })
      .eq('company_id', bot.companyId)
      .eq('id', convo.id);
    await saveMessage({
      companyId: bot.companyId,
      conversationId: convo.id,
      senderType: 'visitor',
      senderId: body.visitorId,
      text: summary || String(action.config.message_text ?? 'I want to talk to a human agent'),
      language,
      bumpUnread: true,
    });
    const assignedAgentId = await assignBestAvailableAgent(bot.companyId, convo.id);
    await notify({
      companyId: bot.companyId,
      type: 'human_takeover',
      title: 'Human takeover requested',
      body: summary || action.label,
      data: { actionId: action.id, conversationId: convo.id, assignedAgentId, name, contact },
      email: false,
    });
    await sb
      .from('quick_action_clicks')
      .update({ completed_at: new Date().toISOString() })
      .eq('quick_action_id', action.id)
      .eq('conversation_id', convo.id);
    return json(
      { ok: true, conversationId: convo.id, message: 'Thanks. Our team will contact you shortly.' },
      200,
      headers,
    );
  }

  await sb.from('quick_action_clicks').update({ completed_at: new Date().toISOString() }).eq('quick_action_id', action.id).eq('conversation_id', convo.id);
  return json({ ok: true, conversationId: convo.id, message: 'Action recorded.' }, 200, headers);
}
