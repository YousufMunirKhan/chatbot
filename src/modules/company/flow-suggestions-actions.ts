'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSessionUser, requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { companyHasFeature } from '@/lib/entitlements';
import { parseGraph } from '@/lib/flows/types';
import { generateFlowSuggestions } from '@/lib/flows/suggest';
import { validateGraph } from './flow-graph';
import { getCompanyId } from './data';

/**
 * Write side of suggested guided chats.
 *
 * TENANT ISOLATION: the company id comes from the SESSION on every statement.
 * A suggestion id arriving from the form is only ever an *additional* filter, so
 * a uuid belonging to another company matches zero rows instead of turning
 * somebody else's suggestion into a flow in this account.
 *
 * GATING: `src/lib/entitlements.ts` is checked here as well as on the page.
 * The review screen imports these actions directly, so a form post reaches them
 * whether or not the page decided to draw the button.
 */

export type ActionState = { error?: string; ok?: boolean; message?: string };

const PATH = '/company/flows/suggestions';
const FLOWS_PATH = '/company/flows';

const NOT_ENTITLED =
  'Your plan does not include Guided chats. See Billing to change your package.';

/**
 * Run the analysis on demand.
 *
 * Rate-limited to one run every ten minutes per company. A run reads thousands
 * of messages and may make up to three model calls, and pressing the button
 * twice in a row cannot tell an owner anything new — the conversations have not
 * changed in the meantime.
 */
export async function generateFlowSuggestionsAction(): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  if (!(await companyHasFeature('flows'))) return { error: NOT_ENTITLED };

  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();

  const { data: recent } = await sb
    .from('flow_suggestion_runs')
    .select('created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastAt = (recent as { created_at?: string } | null)?.created_at;
  if (lastAt && Date.now() - new Date(lastAt).getTime() < 10 * 60_000) {
    return {
      error:
        'Already looked in the last ten minutes. New suggestions appear as more people ask the same thing.',
    };
  }

  const result = await generateFlowSuggestions(companyId, 30);
  revalidatePath(PATH);

  if (result.status === 'failed') {
    return { error: result.note ?? 'The analysis could not finish. Try again shortly.' };
  }
  if (result.status === 'skipped') {
    return { ok: true, message: result.note ?? 'Not enough conversations yet.' };
  }
  if (result.created === 0 && result.refreshed === 0) {
    return {
      ok: true,
      message:
        'Nothing new — no question came up often enough across separate conversations to be worth its own guided chat.',
    };
  }
  const parts: string[] = [];
  if (result.created > 0) {
    parts.push(`${result.created} new suggestion${result.created === 1 ? '' : 's'}`);
  }
  if (result.refreshed > 0) parts.push(`${result.refreshed} brought up to date`);
  return { ok: true, message: `${parts.join(', ')}.` };
}

/** Confirms the suggestion belongs to the caller's company and returns it. */
async function ownedSuggestion(id: string) {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('flow_suggestions')
    .select('id,status,topic,keywords,conversation_count,proposed_name,proposed_graph')
    .eq('company_id', companyId)
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;
  return { companyId, sb, row: data as Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// Accept
// ---------------------------------------------------------------------------
export type AcceptSuggestionState = ActionState & { flowId?: string };

/**
 * Turn a suggestion into a real flow the owner can edit.
 *
 * It arrives as a DRAFT, always. A suggested flow is a starting point written
 * by a model from six example messages — it has not seen this business's prices
 * or policies, and publishing it unread would put those words in front of
 * customers. Draft means the builder opens on it and nothing runs until a
 * person presses publish, which re-runs the same `validateGraph` gate.
 *
 * The graph is validated again here rather than trusted from the row. It passed
 * on the way in, but the publish gate is cheap and the alternative is a flow in
 * somebody's list that the builder immediately complains about.
 */
export async function acceptFlowSuggestionAction(
  _prev: AcceptSuggestionState,
  formData: FormData,
): Promise<AcceptSuggestionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  if (!(await companyHasFeature('flows'))) return { error: NOT_ENTITLED };

  const parsed = z.object({ id: z.string().uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'That suggestion no longer exists.' };

  const owned = await ownedSuggestion(parsed.data.id);
  if (!owned) return { error: 'That suggestion no longer exists.' };
  const { companyId, sb, row } = owned;

  if (row.status !== 'new') {
    return { error: 'That suggestion has already been dealt with.' };
  }

  const graph = parseGraph(row.proposed_graph);
  const problems = validateGraph(graph);
  if (problems.length > 0) {
    return {
      error: `This draft is no longer usable: ${problems[0]?.message ?? 'it does not pass the checks.'}`,
    };
  }

  const topic = (row.topic as string) ?? '';
  const conversationCount = (row.conversation_count as number) ?? 0;
  const keywords = ((row.keywords as string[]) ?? []).filter(Boolean);

  const { data: created, error } = await sb
    .from('flows')
    .insert({
      company_id: companyId,
      name: ((row.proposed_name as string) || 'Suggested guided chat').slice(0, 120),
      // The description states only what was counted.
      description: `Suggested from ${conversationCount} conversation${
        conversationCount === 1 ? '' : 's'
      } asking about “${topic}”.`.slice(0, 500),
      status: 'draft',
      graph_json: graph,
      channels: [],
      priority: 0,
      version: 1,
    })
    .select('id')
    .single();
  if (error) return { error: error.message };

  const flowId = (created as { id: string }).id;

  // A flow with no trigger never starts, so the strongest word customers used
  // is seeded as one. It is safe to leave active: the flow is a draft, and
  // drafts are not matched by the trigger lookup.
  if (keywords[0]) {
    await sb.from('flow_triggers').insert({
      company_id: companyId,
      flow_id: flowId,
      type: 'keyword',
      match_value: keywords[0].slice(0, 200),
      match_mode: 'contains',
      channels: [],
      is_active: true,
    });
  }

  await sb
    .from('flow_suggestions')
    .update({
      status: 'accepted',
      accepted_flow_id: flowId,
      accepted_at: new Date().toISOString(),
    })
    .eq('company_id', companyId)
    .eq('id', parsed.data.id);

  revalidatePath(PATH);
  revalidatePath(FLOWS_PATH);
  return { ok: true, flowId };
}

// ---------------------------------------------------------------------------
// Dismiss
// ---------------------------------------------------------------------------
const dismissSchema = z.object({
  id: z.string().uuid(),
  reason: z.enum(['already_answered', 'not_worth_a_flow', 'wrong_grouping', 'bad_draft', 'other']),
  note: z.preprocess(
    (x) => (typeof x === 'string' && x.trim() ? x.trim() : undefined),
    z.string().max(300).optional(),
  ),
});

/**
 * Say no, and mean it.
 *
 * The row stays, carrying its reason, and the unique index on
 * (company_id, fingerprint) in migration 0090 is what makes that permanent:
 * next week's run finds the dismissed row for this topic and moves on without
 * spending a model call on it. A suggestion feature that re-asks a question the
 * owner already answered is one the owner stops reading.
 */
export async function dismissFlowSuggestionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  if (!(await companyHasFeature('flows'))) return { error: NOT_ENTITLED };

  const parsed = dismissSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Tell us why, so this one does not come back.' };
  }

  const companyId = await getCompanyId();
  const user = await getSessionUser();
  const sb = createSupabaseServiceClient();

  const { error } = await sb
    .from('flow_suggestions')
    .update({
      status: 'dismissed',
      dismissed_reason: parsed.data.reason,
      dismissed_note: parsed.data.note ?? null,
      dismissed_at: new Date().toISOString(),
      dismissed_by: user?.userId ?? null,
    })
    .eq('company_id', companyId)
    .eq('id', parsed.data.id)
    .eq('status', 'new');
  if (error) return { error: error.message };

  revalidatePath(PATH);
  return { ok: true, message: 'Dismissed. This one will not come back.' };
}
