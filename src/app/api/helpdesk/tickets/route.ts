import { z } from 'zod';
import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { notify } from '@/lib/notify';
import { assignBestAvailableAgent } from '@/lib/agent-routing';
import { logAppError, type AppErrorSeverity } from '@/lib/application-errors';
import { insertHelpdeskAuditLog } from '@/lib/helpdesk/audit';
import { allocateTicketNumber } from '@/lib/tickets/ticket-number';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ticketSchema = z.object({
  conversationId: z.string().uuid().optional(),
  subject: z.string().min(3).max(140),
  details: z.string().min(5).max(4000),
  severity: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  currentRoute: z.string().max(240).optional(),
});

function json(obj: unknown, status = 200) {
  return NextResponse.json(obj, { status });
}

function platformSeverity(severity: string): AppErrorSeverity {
  if (severity === 'urgent') return 'critical';
  if (severity === 'high') return 'error';
  if (severity === 'low') return 'info';
  return 'warning';
}

async function ensureTicketConversation(input: {
  companyId: string;
  userId: string;
  conversationId?: string;
}) {
  const sb = createSupabaseServiceClient();
  if (input.conversationId) {
    const { data } = await sb
      .from('conversations')
      .select('id')
      .eq('company_id', input.companyId)
      .eq('id', input.conversationId)
      .maybeSingle();
    if (data?.id) return data.id as string;
  }

  const { data, error } = await sb
    .from('conversations')
    .insert({
      company_id: input.companyId,
      channel: 'api',
      status: 'needs_human',
      ai_enabled: false,
      visitor_id: `staff:${input.userId}`,
      priority: 'normal',
      tags: ['helpdesk', 'issue'],
      state_json: { source: 'helpdesk_ticket' },
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Could not create Help Desk ticket.');
  return data.id as string;
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user?.companyId) return json({ error: 'unauthorized' }, 401);
  if (user.role !== ROLES.COMPANY_ADMIN && user.role !== ROLES.AGENT && !user.isSuperAdmin) {
    return json({ error: 'forbidden' }, 403);
  }

  const parsed = ticketSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: 'invalid_request', issues: parsed.error.issues }, 400);

  const sb = createSupabaseServiceClient();
  const conversationId = await ensureTicketConversation({
    companyId: user.companyId,
    userId: user.userId,
    conversationId: parsed.data.conversationId,
  });

  const now = new Date().toISOString();
  const ticketNumber = await allocateTicketNumber(user.companyId);
  await sb
    .from('conversations')
    .update({
      ai_enabled: false,
      status: 'needs_human',
      priority: parsed.data.severity,
      tags: ['helpdesk', 'issue'],
      unread_count: 1,
      last_message_at: now,
      state_json: {
        source: 'helpdesk_ticket',
        ticketNumber,
        currentRoute: parsed.data.currentRoute || null,
        reportedBy: user.email,
      },
    })
    .eq('company_id', user.companyId)
    .eq('id', conversationId);

  await sb.from('messages').insert({
    company_id: user.companyId,
    conversation_id: conversationId,
    channel: 'api',
    sender_type: 'system',
    sender_id: user.userId,
    content_text: `${ticketNumber} created by ${user.email}: ${parsed.data.subject}`,
    content_type: 'system',
    metadata_json: {
      source: 'helpdesk_ticket',
      ticketNumber,
      severity: parsed.data.severity,
      currentRoute: parsed.data.currentRoute || null,
    },
  });

  await sb.from('conversation_internal_notes').insert({
    company_id: user.companyId,
    conversation_id: conversationId,
    user_id: user.userId,
    note: [
      `Ticket: ${ticketNumber}`,
      `Subject: ${parsed.data.subject}`,
      `Severity: ${parsed.data.severity}`,
      parsed.data.currentRoute ? `Route: ${parsed.data.currentRoute}` : null,
      '',
      parsed.data.details,
    ].filter((line) => line != null).join('\n'),
  });

  const assignedAgentId = await assignBestAvailableAgent(user.companyId, conversationId);
  await notify({
    companyId: user.companyId,
    type: 'helpdesk_issue_reported',
    title: `Help Desk ticket: ${parsed.data.subject}`,
    body: parsed.data.details,
    data: {
      conversationId,
      ticketNumber,
      assignedAgentId,
      severity: parsed.data.severity,
      currentRoute: parsed.data.currentRoute || null,
      reportedBy: user.email,
      reportedByUserId: user.userId,
      source: 'helpdesk_chat_ticket_pill',
    },
    email: true,
  });

  await insertHelpdeskAuditLog({
    companyId: user.companyId,
    actorUserId: user.userId,
    source: 'chat',
    actionName: 'helpdesk_ticket_created',
    question: parsed.data.subject,
    answer: parsed.data.details,
    status: 'info',
    metadata: {
      conversationId,
      ticketNumber,
      severity: parsed.data.severity,
      currentRoute: parsed.data.currentRoute || null,
      assignedAgentId,
    },
  });

  await logAppError({
    companyId: user.companyId,
    userId: user.userId,
    conversationId,
    source: 'helpdesk_issue_report',
    severity: platformSeverity(parsed.data.severity),
    message: parsed.data.subject,
    route: parsed.data.currentRoute || '/company/help-desk?tab=ask',
    metadata: {
      details: parsed.data.details,
      ticketNumber,
      reportedBy: user.email,
      delivery: 'inbox_ticket_company_notification_platform_log',
    },
  });

  return json({
    ok: true,
    conversationId,
    ticketNumber,
    inboxHref: `/company/inbox/${conversationId}`,
    assignedAgentId,
  });
}
