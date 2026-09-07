import { createSupabaseServiceClient } from '@/lib/db/server';
import { logger } from '@/lib/logger';
import { notify } from '@/lib/notify';
import {
  addBusinessMinutes,
  buildSchedule,
  businessMinutesBetween,
  fromZonedTime,
  toZonedTime,
  type BusinessDay,
} from './schedule';

export interface SlaPolicy {
  id: string;
  name: string;
  appliesPriority: string | null;
  appliesChannel: string | null;
  appliesGroupId: string | null;
  firstResponseMinutes: number;
  resolutionMinutes: number | null;
  businessHoursOnly: boolean;
  escalateBeforeMinutes: number | null;
  escalateToUserId: string | null;
  priority: number;
}

export interface SlaMatchContext {
  priority?: string | null;
  channel?: string | null;
  groupId?: string | null;
}

/**
 * Pick the policy that governs a conversation.
 *
 * A policy only applies if every filter it sets matches. Among the survivors the
 * most specific wins — a rule written for "urgent WhatsApp" must beat the
 * catch-all, regardless of the order rows come back in — with the explicit
 * `priority` column as the tie-break the admin controls.
 */
export function selectPolicy(policies: SlaPolicy[], ctx: SlaMatchContext): SlaPolicy | null {
  const eligible = policies.filter((p) => {
    if (p.appliesPriority && p.appliesPriority !== (ctx.priority ?? 'normal')) return false;
    if (p.appliesChannel && p.appliesChannel !== ctx.channel) return false;
    if (p.appliesGroupId && p.appliesGroupId !== ctx.groupId) return false;
    return true;
  });
  if (eligible.length === 0) return null;

  const specificity = (p: SlaPolicy) =>
    (p.appliesPriority ? 1 : 0) + (p.appliesChannel ? 1 : 0) + (p.appliesGroupId ? 1 : 0);

  return eligible.sort((a, b) => {
    if (specificity(b) !== specificity(a)) return specificity(b) - specificity(a);
    if (b.priority !== a.priority) return b.priority - a.priority;
    // Last resort: the tighter target, so a stricter rule is never skipped.
    return a.firstResponseMinutes - b.firstResponseMinutes;
  })[0] as SlaPolicy;
}

async function loadPolicies(companyId: string): Promise<SlaPolicy[]> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('sla_policies')
    .select(
      'id,name,applies_priority,applies_channel,applies_group_id,first_response_minutes,' +
        'resolution_minutes,business_hours_only,escalate_before_minutes,escalate_to_user_id,priority',
    )
    .eq('company_id', companyId)
    .eq('is_active', true)
    .limit(100);
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    appliesPriority: (row.applies_priority as string) ?? null,
    appliesChannel: (row.applies_channel as string) ?? null,
    appliesGroupId: (row.applies_group_id as string) ?? null,
    firstResponseMinutes: (row.first_response_minutes as number) ?? 15,
    resolutionMinutes: (row.resolution_minutes as number) ?? null,
    businessHoursOnly: Boolean(row.business_hours_only),
    escalateBeforeMinutes: (row.escalate_before_minutes as number) ?? null,
    escalateToUserId: (row.escalate_to_user_id as string) ?? null,
    priority: (row.priority as number) ?? 0,
  }));
}

/**
 * The company's opening hours, plus the timezone those hours are written in.
 *
 * "09:00" means nine in the morning where the shop is, so the timezone has to
 * travel with the schedule — without it every business-hours target was wrong
 * by the company's UTC offset.
 */
async function loadSchedule(companyId: string): Promise<{
  schedule: ReturnType<typeof buildSchedule>;
  timeZone: string | null;
}> {
  const sb = createSupabaseServiceClient();
  const [hoursRes, locationRes] = await Promise.all([
    sb
      .from('company_business_hours')
      .select('day_of_week,is_closed,open_time,close_time')
      .eq('company_id', companyId)
      .is('location_id', null),
    sb
      .from('company_locations')
      .select('timezone,is_primary')
      .eq('company_id', companyId)
      .order('is_primary', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const days: BusinessDay[] = ((hoursRes.data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({
    dayOfWeek: row.day_of_week as number,
    isClosed: Boolean(row.is_closed),
    openTime: (row.open_time as string) ?? null,
    closeTime: (row.close_time as string) ?? null,
  }));

  const timeZone = ((locationRes.data as { timezone?: string | null } | null)?.timezone ?? null) || null;
  return { schedule: buildSchedule(days), timeZone };
}

async function logEvent(params: {
  companyId: string;
  conversationId: string;
  policyId: string | null;
  event: string;
  minutes?: number | null;
}): Promise<void> {
  const sb = createSupabaseServiceClient();
  const { error } = await sb.from('sla_events').insert({
    company_id: params.companyId,
    conversation_id: params.conversationId,
    policy_id: params.policyId,
    event: params.event,
    minutes: params.minutes ?? null,
  });
  if (error) logger.warn('SLA event insert failed', { error: error.message });
}

/**
 * Start the clock when a conversation needs a human.
 *
 * Idempotent: re-running for the same conversation leaves the original
 * deadlines alone, so a webhook retry or a second escalation cannot quietly
 * extend an SLA that is already running.
 */
export async function startSlaClock(params: {
  companyId: string;
  conversationId: string;
  priority?: string | null;
  channel?: string | null;
  groupId?: string | null;
  at?: Date;
}): Promise<{ policyId: string; firstResponseDueAt: string } | null> {
  try {
    const sb = createSupabaseServiceClient();
    const { data: existing } = await sb
      .from('sla_states')
      .select('conversation_id')
      .eq('conversation_id', params.conversationId)
      .maybeSingle();
    if (existing) return null;

    const [policies, hours] = await Promise.all([
      loadPolicies(params.companyId),
      loadSchedule(params.companyId),
    ]);
    const policy = selectPolicy(policies, {
      priority: params.priority,
      channel: params.channel,
      groupId: params.groupId,
    });
    if (!policy) return null;

    const startedAt = params.at ?? new Date();

    // Business-hours targets are computed in the shop's own wall-clock frame and
    // converted back; elapsed-time targets need no conversion at all.
    const zone = policy.businessHoursOnly ? hours.timeZone : null;
    const activeSchedule = policy.businessHoursOnly ? hours.schedule : new Map();
    const localStart = toZonedTime(startedAt, zone);

    const firstResponseDue = fromZonedTime(
      addBusinessMinutes(localStart, policy.firstResponseMinutes, activeSchedule),
      zone,
    );
    const resolutionDue = policy.resolutionMinutes
      ? fromZonedTime(addBusinessMinutes(localStart, policy.resolutionMinutes, activeSchedule), zone)
      : null;

    const { error } = await sb.from('sla_states').insert({
      conversation_id: params.conversationId,
      company_id: params.companyId,
      policy_id: policy.id,
      started_at: startedAt.toISOString(),
      first_response_due_at: firstResponseDue.toISOString(),
      resolution_due_at: resolutionDue ? resolutionDue.toISOString() : null,
    });
    // 23505 = a concurrent escalation already started this clock.
    if (error && (error as { code?: string }).code !== '23505') {
      logger.warn('Could not start the SLA clock', { error: error.message });
      return null;
    }

    await logEvent({
      companyId: params.companyId,
      conversationId: params.conversationId,
      policyId: policy.id,
      event: 'started',
      minutes: policy.firstResponseMinutes,
    });
    return { policyId: policy.id, firstResponseDueAt: firstResponseDue.toISOString() };
  } catch (err) {
    // SLA bookkeeping must never block a customer conversation.
    logger.error('startSlaClock failed', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** Stop the first-response clock the moment an agent replies. */
export async function markFirstResponse(params: {
  companyId: string;
  conversationId: string;
  at?: Date;
}): Promise<void> {
  try {
    const sb = createSupabaseServiceClient();
    const { data } = await sb
      .from('sla_states')
      .select('policy_id,started_at,first_response_at,first_response_due_at')
      .eq('conversation_id', params.conversationId)
      .eq('company_id', params.companyId)
      .maybeSingle();
    const row = data as {
      policy_id: string | null;
      started_at: string;
      first_response_at: string | null;
    } | null;
    if (!row || row.first_response_at) return;

    const at = params.at ?? new Date();
    const hours = await loadSchedule(params.companyId);
    // Measured in the shop's own frame, matching how the deadline was set.
    const minutes = businessMinutesBetween(
      toZonedTime(new Date(row.started_at), hours.timeZone),
      toZonedTime(at, hours.timeZone),
      hours.schedule,
    );

    await sb
      .from('sla_states')
      .update({ first_response_at: at.toISOString(), updated_at: at.toISOString() })
      .eq('conversation_id', params.conversationId)
      .eq('company_id', params.companyId);

    await logEvent({
      companyId: params.companyId,
      conversationId: params.conversationId,
      policyId: row.policy_id,
      event: 'responded',
      minutes,
    });
  } catch (err) {
    logger.error('markFirstResponse failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

/** Stop the resolution clock when the conversation closes. */
export async function markResolved(params: {
  companyId: string;
  conversationId: string;
  at?: Date;
}): Promise<void> {
  try {
    const sb = createSupabaseServiceClient();
    const { data } = await sb
      .from('sla_states')
      .select('policy_id,started_at,resolved_at')
      .eq('conversation_id', params.conversationId)
      .eq('company_id', params.companyId)
      .maybeSingle();
    const row = data as { policy_id: string | null; started_at: string; resolved_at: string | null } | null;
    if (!row || row.resolved_at) return;

    const at = params.at ?? new Date();
    const hours = await loadSchedule(params.companyId);
    // Measured in the shop's own frame, matching how the deadline was set.
    const minutes = businessMinutesBetween(
      toZonedTime(new Date(row.started_at), hours.timeZone),
      toZonedTime(at, hours.timeZone),
      hours.schedule,
    );

    await sb
      .from('sla_states')
      .update({ resolved_at: at.toISOString(), updated_at: at.toISOString() })
      .eq('conversation_id', params.conversationId)
      .eq('company_id', params.companyId);

    await logEvent({
      companyId: params.companyId,
      conversationId: params.conversationId,
      policyId: row.policy_id,
      event: 'resolved',
      minutes,
    });
  } catch (err) {
    logger.error('markResolved failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

export interface BreachSweepResult {
  warned: number;
  responseBreaches: number;
  resolutionBreaches: number;
}

/**
 * Sweep for clocks that have run out. Driven by the cron route.
 *
 * Each state row is flagged before the notification is sent and the flag is part
 * of the WHERE clause, so a breach is announced exactly once even if two sweeps
 * overlap.
 */
export async function sweepSlaBreaches(limit = 200): Promise<BreachSweepResult> {
  const sb = createSupabaseServiceClient();
  const now = new Date();
  const result: BreachSweepResult = { warned: 0, responseBreaches: 0, resolutionBreaches: 0 };

  const { data: responseDue } = await sb
    .from('sla_states')
    .select('conversation_id,company_id,policy_id,first_response_due_at,warned_at')
    .is('first_response_at', null)
    .eq('first_response_breached', false)
    .lte('first_response_due_at', now.toISOString())
    .limit(limit);

  for (const row of (responseDue ?? []) as Array<Record<string, unknown>>) {
    const { data: claimed } = await sb
      .from('sla_states')
      .update({ first_response_breached: true, updated_at: now.toISOString() })
      .eq('conversation_id', row.conversation_id as string)
      .eq('first_response_breached', false)
      .select('conversation_id')
      .maybeSingle();
    if (!claimed) continue;

    result.responseBreaches += 1;
    await logEvent({
      companyId: row.company_id as string,
      conversationId: row.conversation_id as string,
      policyId: (row.policy_id as string) ?? null,
      event: 'breached_response',
    });
    await notifyBreach(row.company_id as string, row.conversation_id as string, 'first response');
  }

  const { data: resolutionDue } = await sb
    .from('sla_states')
    .select('conversation_id,company_id,policy_id,resolution_due_at')
    .is('resolved_at', null)
    .eq('resolution_breached', false)
    .not('resolution_due_at', 'is', null)
    .lte('resolution_due_at', now.toISOString())
    .limit(limit);

  for (const row of (resolutionDue ?? []) as Array<Record<string, unknown>>) {
    const { data: claimed } = await sb
      .from('sla_states')
      .update({ resolution_breached: true, updated_at: now.toISOString() })
      .eq('conversation_id', row.conversation_id as string)
      .eq('resolution_breached', false)
      .select('conversation_id')
      .maybeSingle();
    if (!claimed) continue;

    result.resolutionBreaches += 1;
    await logEvent({
      companyId: row.company_id as string,
      conversationId: row.conversation_id as string,
      policyId: (row.policy_id as string) ?? null,
      event: 'breached_resolution',
    });
    await notifyBreach(row.company_id as string, row.conversation_id as string, 'resolution');
  }

  result.warned = await sweepWarnings(now, limit);
  return result;
}

/** Warn shortly before a first-response deadline, so it can still be met. */
async function sweepWarnings(now: Date, limit: number): Promise<number> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('sla_states')
    .select('conversation_id,company_id,policy_id,first_response_due_at,warned_at,sla_policies(escalate_before_minutes,escalate_to_user_id)')
    .is('first_response_at', null)
    .is('warned_at', null)
    .eq('first_response_breached', false)
    .limit(limit);

  let warned = 0;
  for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
    const policy = row.sla_policies as { escalate_before_minutes?: number; escalate_to_user_id?: string } | null;
    const before = policy?.escalate_before_minutes;
    if (!before || !row.first_response_due_at) continue;
    const due = new Date(row.first_response_due_at as string).getTime();
    if (due - now.getTime() > before * 60_000) continue;

    const { data: claimed } = await sb
      .from('sla_states')
      .update({ warned_at: now.toISOString(), escalated_at: policy?.escalate_to_user_id ? now.toISOString() : null })
      .eq('conversation_id', row.conversation_id as string)
      .is('warned_at', null)
      .select('conversation_id')
      .maybeSingle();
    if (!claimed) continue;

    warned += 1;
    await logEvent({
      companyId: row.company_id as string,
      conversationId: row.conversation_id as string,
      policyId: (row.policy_id as string) ?? null,
      event: policy?.escalate_to_user_id ? 'escalated' : 'warned',
    });
    await notify({
      companyId: row.company_id as string,
      type: 'sla_warning',
      title: 'A conversation is about to breach its SLA',
      body: 'No agent has replied yet and the first-response deadline is close.',
      data: { conversationId: row.conversation_id, assignedAgentId: policy?.escalate_to_user_id ?? null },
      email: false,
    });
  }
  return warned;
}

async function notifyBreach(companyId: string, conversationId: string, kind: string): Promise<void> {
  await notify({
    companyId,
    type: 'sla_breach',
    title: `SLA breached — ${kind}`,
    body: 'A conversation passed its target without being answered.',
    data: { conversationId },
    email: false,
  });
}
