import { createSupabaseServiceClient } from '@/lib/db/server';
import { parseGraph, type FlowGraph } from '@/lib/flows/types';
import { getCompanyId } from './data';

/**
 * Read side of suggested guided chats.
 *
 * TENANT ISOLATION: every query is filtered by the SESSION user's `company_id`,
 * never by an id from the request, and the single-row reader filters by
 * `company_id` *and* `id` so a guessed uuid from another tenant returns null
 * rather than somebody else's conversations.
 *
 * The split between evidence and proposal that migration 0090 keeps in separate
 * columns is preserved in the shape below, because the review screen has to be
 * able to say which half is which: `evidence` was counted, `proposal` was
 * written by a model.
 */

export type FlowSuggestionStatus = 'new' | 'accepted' | 'dismissed';

export type DismissReason =
  | 'already_answered'
  | 'not_worth_a_flow'
  | 'wrong_grouping'
  | 'bad_draft'
  | 'other';

export interface FlowSuggestionRow {
  id: string;
  status: FlowSuggestionStatus;
  /** Deterministic label built from the customers' own most common words. */
  topic: string;
  keywords: string[];
  /** A real customer message from the middle of the group. A quote. */
  representative: string;
  /** COUNTED: visitor messages in this group. */
  questionCount: number;
  /** COUNTED: distinct conversations the group appeared in. */
  conversationCount: number;
  /** COUNTED: answers on this topic the assistant was not confident about. */
  lowConfidenceCount: number;
  /** Verbatim customer messages, one per conversation. */
  examples: string[];
  /** Which conversations the count came from, so the claim can be checked. */
  conversationIds: string[];
  periodStart: string;
  periodEnd: string;
  /** WRITTEN BY THE MODEL. */
  proposedName: string;
  /** WRITTEN BY THE MODEL, and already past `validateGraph`. */
  proposedGraph: FlowGraph;
  model: string | null;
  dismissedReason: DismissReason | null;
  dismissedNote: string | null;
  acceptedFlowId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FlowSuggestionRunRow {
  status: string;
  note: string | null;
  periodDays: number;
  topicsFound: number;
  suggested: number;
  rejected: number;
  createdAt: string;
  usedModel: boolean;
}

const COLUMNS =
  'id,status,topic,keywords,representative,question_count,conversation_count,low_confidence_count,' +
  'example_questions,example_conversation_ids,period_start,period_end,proposed_name,proposed_graph,' +
  'model,dismissed_reason,dismissed_note,accepted_flow_id,created_at,updated_at';

function toRow(raw: Record<string, unknown>): FlowSuggestionRow {
  return {
    id: raw.id as string,
    status: (raw.status as FlowSuggestionStatus) ?? 'new',
    topic: (raw.topic as string) ?? '',
    keywords: (raw.keywords as string[]) ?? [],
    representative: (raw.representative as string) ?? '',
    questionCount: (raw.question_count as number) ?? 0,
    conversationCount: (raw.conversation_count as number) ?? 0,
    lowConfidenceCount: (raw.low_confidence_count as number) ?? 0,
    examples: (raw.example_questions as string[]) ?? [],
    conversationIds: (raw.example_conversation_ids as string[]) ?? [],
    periodStart: raw.period_start as string,
    periodEnd: raw.period_end as string,
    proposedName: (raw.proposed_name as string) ?? '',
    // Defensive even though the writer validated it: the row could have been
    // edited by hand, and a malformed graph must render as an empty preview
    // rather than throw on somebody's review screen.
    proposedGraph: parseGraph(raw.proposed_graph),
    model: (raw.model as string) ?? null,
    dismissedReason: (raw.dismissed_reason as DismissReason) ?? null,
    dismissedNote: (raw.dismissed_note as string) ?? null,
    acceptedFlowId: (raw.accepted_flow_id as string) ?? null,
    createdAt: raw.created_at as string,
    updatedAt: raw.updated_at as string,
  };
}

/** Open suggestions, biggest first — the one most people asked about is the one to read. */
export async function listFlowSuggestions(
  status: FlowSuggestionStatus[] = ['new'],
): Promise<FlowSuggestionRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('flow_suggestions')
    .select(COLUMNS)
    .eq('company_id', companyId)
    .in('status', status)
    .order('conversation_count', { ascending: false })
    .limit(50);

  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map(toRow);
}

export async function getFlowSuggestion(id: string): Promise<FlowSuggestionRow | null> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('flow_suggestions')
    .select(COLUMNS)
    .eq('company_id', companyId)
    .eq('id', id)
    .maybeSingle();
  return data ? toRow(data as unknown as Record<string, unknown>) : null;
}

export async function getLatestFlowSuggestionRun(): Promise<FlowSuggestionRunRow | null> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('flow_suggestion_runs')
    .select('status,note,period_days,topics_found,suggested,rejected,created_at,model')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    status: row.status as string,
    note: (row.note as string) ?? null,
    periodDays: (row.period_days as number) ?? 30,
    topicsFound: (row.topics_found as number) ?? 0,
    suggested: (row.suggested as number) ?? 0,
    rejected: (row.rejected as number) ?? 0,
    createdAt: row.created_at as string,
    usedModel: Boolean(row.model),
  };
}

export interface FlowSuggestionCounts {
  open: number;
  accepted: number;
  dismissed: number;
  /** Conversations covered by the open suggestions. A count, not an estimate. */
  conversationsCovered: number;
}

export async function getFlowSuggestionCounts(): Promise<FlowSuggestionCounts> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('flow_suggestions')
    .select('status,conversation_count')
    .eq('company_id', companyId)
    .limit(500);

  const counts: FlowSuggestionCounts = { open: 0, accepted: 0, dismissed: 0, conversationsCovered: 0 };
  for (const row of (data ?? []) as unknown as Array<{
    status: FlowSuggestionStatus;
    conversation_count: number | null;
  }>) {
    if (row.status === 'accepted') counts.accepted += 1;
    else if (row.status === 'dismissed') counts.dismissed += 1;
    else {
      counts.open += 1;
      counts.conversationsCovered += row.conversation_count ?? 0;
    }
  }
  return counts;
}
