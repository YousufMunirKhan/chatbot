import { z } from 'zod';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { ApiError, apiData, withApiAuth } from '@/lib/api/handler';
import { dispatchDeveloperEvent } from '@/lib/api/developer-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  channel: z.enum(['whatsapp', 'email']),
  subject: z.string().max(200).optional(),
  message: z.string().min(1, 'message is required').max(2000),
  /** ISO-8601. Omitted or in the past → the next cron run picks it up. */
  schedule_at: z.string().optional(),
});

/**
 * POST /api/v1/broadcasts — schedule a message to the contact list.
 *
 * This only creates the row; the existing broadcast cron dispatches it, so an
 * API caller cannot bypass the sending limits that job enforces.
 */
export const POST = withApiAuth('broadcasts:write', async (ctx) => {
  const body = bodySchema.parse(await ctx.json());

  let scheduleAt: string | null = null;
  if (body.schedule_at) {
    const date = new Date(body.schedule_at);
    if (Number.isNaN(date.getTime())) {
      throw new ApiError('invalid_request', '`schedule_at` must be an ISO-8601 date/time.');
    }
    scheduleAt = date.toISOString();
  }

  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('broadcasts')
    .insert({
      // TENANT ISOLATION: the key's company, never a request value.
      company_id: ctx.companyId,
      channel: body.channel,
      subject: body.channel === 'email' ? body.subject ?? null : null,
      message: body.message,
      audience: 'all_leads',
      schedule_at: scheduleAt,
      status: 'scheduled',
    })
    .select('id,channel,subject,message,audience,schedule_at,status,sent_count,created_at')
    .single();
  if (error || !data) throw new ApiError('internal_error', 'Could not create the broadcast.');

  const row = data as Record<string, unknown>;
  const broadcast = {
    id: row.id as string,
    channel: row.channel as string,
    subject: (row.subject as string) ?? null,
    message: row.message as string,
    audience: row.audience as string,
    schedule_at: (row.schedule_at as string) ?? null,
    status: row.status as string,
    sent_count: Number(row.sent_count ?? 0),
    created_at: (row.created_at as string) ?? null,
  };

  await dispatchDeveloperEvent({
    companyId: ctx.companyId,
    event: 'broadcast.created',
    title: `Broadcast scheduled on ${broadcast.channel}`,
    body: broadcast.message.slice(0, 200),
    data: { ...broadcast },
  });

  return apiData(broadcast, undefined, 201);
});
