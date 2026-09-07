import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from './data';

export interface SlaPolicyRow {
  id: string;
  name: string;
  appliesPriority: string | null;
  appliesChannel: string | null;
  firstResponseMinutes: number;
  resolutionMinutes: number | null;
  businessHoursOnly: boolean;
  escalateBeforeMinutes: number | null;
  escalateToUserId: string | null;
  isActive: boolean;
  priority: number;
  createdAt: string;
}

export async function listSlaPolicies(): Promise<SlaPolicyRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('sla_policies')
    .select(
      'id,name,applies_priority,applies_channel,first_response_minutes,resolution_minutes,' +
        'business_hours_only,escalate_before_minutes,escalate_to_user_id,is_active,priority,created_at',
    )
    .eq('company_id', companyId)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(100);

  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    appliesPriority: (row.applies_priority as string) ?? null,
    appliesChannel: (row.applies_channel as string) ?? null,
    firstResponseMinutes: (row.first_response_minutes as number) ?? 15,
    resolutionMinutes: (row.resolution_minutes as number) ?? null,
    businessHoursOnly: Boolean(row.business_hours_only),
    escalateBeforeMinutes: (row.escalate_before_minutes as number) ?? null,
    escalateToUserId: (row.escalate_to_user_id as string) ?? null,
    isActive: row.is_active !== false,
    priority: (row.priority as number) ?? 0,
    createdAt: row.created_at as string,
  }));
}

export interface SlaPerformance {
  tracked: number;
  responded: number;
  responseBreaches: number;
  resolutionBreaches: number;
  /** Percentage of tracked conversations answered inside the target. */
  attainment: number;
  medianResponseMinutes: number | null;
  atRisk: number;
}

/**
 * Headline SLA numbers for the last `days` days.
 *
 * Both queries are bounded and hit the company index; the median is computed in
 * memory over the returned minutes rather than in SQL so this works without a
 * percentile extension.
 */
export async function getSlaPerformance(days = 30): Promise<SlaPerformance> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const [statesRes, eventsRes] = await Promise.all([
    sb
      .from('sla_states')
      .select('first_response_at,first_response_breached,resolution_breached,first_response_due_at,resolved_at')
      .eq('company_id', companyId)
      .gte('started_at', since)
      .limit(5000),
    sb
      .from('sla_events')
      .select('minutes')
      .eq('company_id', companyId)
      .eq('event', 'responded')
      .gte('created_at', since)
      .limit(5000),
  ]);

  const states = (statesRes.data ?? []) as unknown as Array<Record<string, unknown>>;
  const tracked = states.length;
  const responded = states.filter((s) => Boolean(s.first_response_at)).length;
  const responseBreaches = states.filter((s) => s.first_response_breached === true).length;
  const resolutionBreaches = states.filter((s) => s.resolution_breached === true).length;

  const now = Date.now();
  const atRisk = states.filter((s) => {
    if (s.first_response_at || s.first_response_breached === true) return false;
    const due = s.first_response_due_at ? new Date(s.first_response_due_at as string).getTime() : 0;
    // "About to breach" is the last quarter-hour before the deadline.
    return due > now && due - now <= 15 * 60_000;
  }).length;

  const minutes = ((eventsRes.data ?? []) as unknown as Array<{ minutes: number | null }>)
    .map((e) => e.minutes)
    .filter((m): m is number => typeof m === 'number')
    .sort((a, b) => a - b);
  const medianResponseMinutes = minutes.length
    ? (minutes[Math.floor((minutes.length - 1) / 2)] as number)
    : null;

  return {
    tracked,
    responded,
    responseBreaches,
    resolutionBreaches,
    attainment: tracked === 0 ? 100 : Math.round(((tracked - responseBreaches) / tracked) * 100),
    medianResponseMinutes,
    atRisk,
  };
}

export interface SlaBreachRow {
  conversationId: string;
  event: string;
  createdAt: string;
}

export async function listRecentSlaBreaches(limit = 20): Promise<SlaBreachRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('sla_events')
    .select('conversation_id,event,created_at')
    .eq('company_id', companyId)
    .in('event', ['breached_response', 'breached_resolution', 'escalated'])
    .order('created_at', { ascending: false })
    .limit(limit);
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({
    conversationId: (row.conversation_id as string) ?? '',
    event: row.event as string,
    createdAt: row.created_at as string,
  }));
}

export interface TeamMemberOption {
  userId: string;
  label: string;
}

/** Members who can be named as an escalation target. */
export async function listEscalationTargets(): Promise<TeamMemberOption[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('company_users')
    .select('user_id,role,users(email,full_name)')
    .eq('company_id', companyId)
    .limit(100);
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => {
    const user = row.users as { email?: string; full_name?: string } | null;
    return {
      userId: row.user_id as string,
      label: user?.full_name || user?.email || (row.user_id as string).slice(0, 8),
    };
  });
}
