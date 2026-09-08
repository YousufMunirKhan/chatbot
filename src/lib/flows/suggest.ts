import { createSupabaseServiceClient } from '@/lib/db/server';
import { logger } from '@/lib/logger';
import { getChatProviderAsync } from '@/lib/ai/providers';
import { parseGraph } from '@/lib/flows/types';
import { similarity, tokenize } from '@/lib/flows/nlu';
import { validateGraph } from '@/modules/company/flow-graph';
import {
  MAX_MESSAGES_SCANNED,
  MAX_SUGGESTIONS_PER_RUN,
  MIN_CLUSTER_CONVERSATIONS,
  MIN_CONVERSATIONS_FOR_SUGGESTIONS,
  buildSuggestionPrompt,
  clusterQuestions,
  countLowConfidence,
  sanitiseSuggestedFlow,
  suggestionFingerprint,
  topicLabel,
  SUGGESTION_SYSTEM_PROMPT,
  type QuestionCluster,
} from './suggest-prompt';

/**
 * Suggested guided chats, generated from a company's own conversations.
 *
 * "Forty-seven people asked about delivery last month. The assistant was unsure
 *  twelve times. Here is a guided chat that answers it properly — publish it?"
 *
 * TWO PASSES, AND ONLY ONE OF THEM IS A MODEL
 * -------------------------------------------
 * The counting pass reads visitor messages and quality logs and groups them
 * (`suggest-prompt.ts`). Everything an owner is shown as fact comes from there:
 * how many conversations, how many low-confidence answers, which conversations,
 * and six real messages they can read for themselves. The model pass is asked
 * for one thing only — a `FlowGraph` — and its answer is put through
 * `sanitiseSuggestedFlow`, `parseGraph` and `validateGraph` before it is stored.
 * A draft that does not validate is discarded and counted on the run; it is
 * never shown to anybody.
 *
 * WHAT BOUNDS THE COST
 * --------------------
 * A company under `MIN_CONVERSATIONS_FOR_SUGGESTIONS` is skipped rather than
 * mined for suggestions it has no evidence for. A topic must recur across
 * `MIN_CLUSTER_CONVERSATIONS` separate conversations. At most
 * `MAX_SUGGESTIONS_PER_RUN` model calls happen per company per run, and a topic
 * that already has a suggestion — open, accepted or dismissed — costs nothing:
 * an open one has its counts refreshed by arithmetic alone, and the other two
 * are skipped before the model is ever reached.
 */

export interface FlowSuggestionRunResult {
  status: 'ok' | 'skipped' | 'failed';
  note?: string;
  /** Newly drafted suggestions. */
  created: number;
  /** Existing open suggestions whose counts were brought up to date. */
  refreshed: number;
  /** Model drafts thrown away for failing validation. */
  rejected: number;
}

/** Quality-log labels that mean the assistant was not answering with confidence. */
const UNSURE_LABELS = ['missing_info', 'wrong_answer', 'weak_retrieval', 'hallucination_risk', 'needs_human'];
const LOW_CONFIDENCE = 0.5;
const MAX_ROWS = 8000;

interface MessageRow {
  conversation_id: string;
  content_text: string | null;
}

export async function generateFlowSuggestions(
  companyId: string,
  days = 30,
): Promise<FlowSuggestionRunResult> {
  const sb = createSupabaseServiceClient();
  const now = new Date();
  const periodStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const since = periodStart.toISOString();

  const { data: runRow } = await sb
    .from('flow_suggestion_runs')
    .insert({
      company_id: companyId,
      period_days: days,
      period_start: since,
      period_end: now.toISOString(),
      status: 'running',
    })
    .select('id')
    .maybeSingle();
  const runId = (runRow as { id: string } | null)?.id ?? null;

  const finish = async (
    status: 'ok' | 'failed' | 'skipped',
    note?: string,
    extra?: Record<string, unknown>,
  ) => {
    if (!runId) return;
    await sb
      .from('flow_suggestion_runs')
      .update({
        status,
        note: note ?? null,
        finished_at: new Date().toISOString(),
        ...(extra ?? {}),
      })
      .eq('id', runId);
  };

  try {
    const [convoRes, messageRes, intentRes, qualityRes, existingRes, triggerRes] = await Promise.all([
      sb
        .from('conversations')
        .select('id')
        .eq('company_id', companyId)
        .gte('started_at', since)
        .limit(MAX_ROWS),
      sb
        .from('messages')
        .select('conversation_id,content_text')
        .eq('company_id', companyId)
        .eq('sender_type', 'visitor')
        .gte('created_at', since)
        // Newest first, because the cap bites on exactly the companies whose
        // month does not fit in it — and on those, what people asked last week
        // is a better guide than what they asked four weeks ago. Grouping
        // itself does not depend on the order they arrive in.
        .order('created_at', { ascending: false })
        .limit(MAX_MESSAGES_SCANNED),
      sb
        .from('bot_intents')
        .select('name,examples')
        .eq('company_id', companyId)
        .eq('is_active', true)
        .limit(200),
      // The assistant's own record of answers it was not confident about.
      sb
        .from('answer_quality_logs')
        .select('question')
        .eq('company_id', companyId)
        .gte('created_at', since)
        .or(
          `failure_reason.not.is.null,confidence_score.lt.${LOW_CONFIDENCE},auto_audit_label.in.(${UNSURE_LABELS.join(',')})`,
        )
        .limit(1000),
      sb
        .from('flow_suggestions')
        .select('id,fingerprint,status')
        .eq('company_id', companyId)
        .limit(500),
      // What the company already has a guided chat for.
      sb
        .from('flow_triggers')
        .select('type,match_value')
        .eq('company_id', companyId)
        .eq('is_active', true)
        .limit(500),
    ]);

    const conversationCount = (convoRes.data ?? []).length;
    if (conversationCount < MIN_CONVERSATIONS_FOR_SUGGESTIONS) {
      const note = `Only ${conversationCount} conversations in the last ${days} days — at least ${MIN_CONVERSATIONS_FOR_SUGGESTIONS} are needed before a repeated question means anything.`;
      await finish('skipped', note);
      return { status: 'skipped', note, created: 0, refreshed: 0, rejected: 0 };
    }

    const messages = ((messageRes.data ?? []) as unknown as MessageRow[])
      .filter((m) => (m.content_text ?? '').trim().length > 0)
      .map((m) => ({ conversationId: m.conversation_id, text: (m.content_text ?? '').trim() }));

    const intents = ((intentRes.data ?? []) as unknown as Array<{ name: string; examples: string[] | null }>)
      .map((i) => ({ name: i.name, examples: i.examples ?? [] }))
      .filter((i) => i.examples.length > 0);

    const lowConfidence = ((qualityRes.data ?? []) as unknown as Array<{ question: string | null }>)
      .map((q) => ({ question: (q.question ?? '').trim() }))
      .filter((q) => q.question.length > 3);

    const clustered = countLowConfidence(
      clusterQuestions(messages, intents, tokenize, similarity),
      lowConfidence,
      tokenize,
      similarity,
    );

    const covered = coveredTerms(
      (triggerRes.data ?? []) as unknown as Array<{ type: string; match_value: string | null }>,
    );

    const worthwhile = clustered.filter(
      (c) => c.conversationCount >= MIN_CLUSTER_CONVERSATIONS && !isCovered(c, covered),
    );

    const existing = new Map(
      ((existingRes.data ?? []) as unknown as Array<{ id: string; fingerprint: string; status: string }>).map(
        (row) => [row.fingerprint, row],
      ),
    );

    let created = 0;
    let refreshed = 0;
    let rejected = 0;
    // Tokens are totalled across the run rather than kept per call — a run is
    // the unit an operator asks the cost of.
    const usage = { model: '', input: 0, output: 0 };
    let modelCalls = 0;
    let provider: Awaited<ReturnType<typeof getChatProviderAsync>> | null = null;

    // Two clusters can reduce to the same fingerprint when their strongest
    // words coincide. The unique index would refuse the second one anyway —
    // this refuses it before it costs a model call.
    const handled = new Set<string>();

    for (const cluster of worthwhile) {
      const fingerprint = suggestionFingerprint(cluster.key);
      if (handled.has(fingerprint)) continue;
      handled.add(fingerprint);
      const already = existing.get(fingerprint);

      // Dismissed or accepted: the owner has answered this one. It never comes
      // back, and it never costs another model call.
      if (already && already.status !== 'new') continue;

      const evidence = evidenceRow(cluster, runId, periodStart, now);

      if (already) {
        // Open already — the counts move week to week, the draft does not.
        const { error } = await sb
          .from('flow_suggestions')
          .update(evidence)
          .eq('company_id', companyId)
          .eq('id', already.id);
        if (error) logger.warn('Could not refresh a flow suggestion', { companyId, error: error.message });
        else refreshed += 1;
        continue;
      }

      if (modelCalls >= MAX_SUGGESTIONS_PER_RUN) continue;

      // Company-scoped: drafting a flow is billed to that company and must
      // obey its plan's model tier like every other reply does.
      if (!provider) provider = await getChatProviderAsync(companyId);
      // The mock provider returns canned text; a fabricated flow is worse than none.
      if (provider.apiType === 'mock') {
        const note = 'No AI provider is configured, so no flow could be drafted.';
        await finish('skipped', note, { topics_found: worthwhile.length });
        return { status: 'skipped', note, created, refreshed, rejected };
      }

      modelCalls += 1;
      const attempt = await draftFlow(companyId, provider, cluster);
      // A rejected draft still cost tokens, so it is still counted here.
      if (attempt.usage) {
        usage.model = attempt.usage.model;
        usage.input += attempt.usage.input;
        usage.output += attempt.usage.output;
      }
      if (!attempt.flow) {
        rejected += 1;
        continue;
      }

      const { error } = await sb.from('flow_suggestions').insert({
        company_id: companyId,
        fingerprint,
        ...evidence,
        proposed_name: attempt.flow.name,
        proposed_graph: attempt.flow.graph,
        model: usage.model || null,
        status: 'new',
      });
      // 23505 is the unique index doing its job — another run got here first.
      if (error && (error as { code?: string }).code !== '23505') {
        logger.warn('Could not save a flow suggestion', { companyId, error: error.message });
        continue;
      }
      if (!error) created += 1;
    }

    await finish('ok', undefined, {
      topics_found: worthwhile.length,
      suggested: created,
      rejected,
      model: usage.model || null,
      input_tokens: usage.input,
      output_tokens: usage.output,
    });
    return { status: 'ok', created, refreshed, rejected };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Flow suggestion run failed', { companyId, error: message });
    await finish('failed', message.slice(0, 400));
    return { status: 'failed', note: message, created: 0, refreshed: 0, rejected: 0 };
  }
}

/** The evidence columns — every one of them a count or a verbatim quote. */
function evidenceRow(
  cluster: QuestionCluster,
  runId: string | null,
  periodStart: Date,
  periodEnd: Date,
): Record<string, unknown> {
  return {
    run_id: runId,
    topic: topicLabel(cluster).slice(0, 120),
    keywords: cluster.keywords,
    representative: cluster.representative,
    question_count: cluster.messageCount,
    conversation_count: cluster.conversationCount,
    low_confidence_count: cluster.lowConfidenceCount,
    example_questions: cluster.examples,
    example_conversation_ids: cluster.conversationIds,
    period_start: periodStart.toISOString(),
    period_end: periodEnd.toISOString(),
  };
}

/**
 * Words the company's live triggers already fire on.
 *
 * Suggesting a delivery flow to somebody who built one last month is how a
 * feature like this loses its credibility, so a topic whose own keywords are
 * already a trigger is left alone.
 */
function coveredTerms(
  triggers: Array<{ type: string; match_value: string | null }>,
): { terms: Set<string>; intents: Set<string> } {
  const terms = new Set<string>();
  const intents = new Set<string>();
  for (const trigger of triggers) {
    const value = (trigger.match_value ?? '').trim();
    if (!value) continue;
    if (trigger.type === 'intent') {
      intents.add(value.toLowerCase());
      continue;
    }
    if (trigger.type !== 'keyword') continue;
    for (const token of tokenize(value)) terms.add(token);
  }
  return { terms, intents };
}

function isCovered(cluster: QuestionCluster, covered: { terms: Set<string>; intents: Set<string> }): boolean {
  if (cluster.intentName && covered.intents.has(cluster.intentName.toLowerCase())) return true;
  // The top two words are what the topic is about; a match further down the
  // list would rule out too much.
  return cluster.keywords.slice(0, 2).some((k) => covered.terms.has(k));
}

interface DraftAttempt {
  /** Present whenever the provider actually answered — a rejected draft still cost tokens. */
  usage: { model: string; input: number; output: number } | null;
  /** Null when nothing usable came back. */
  flow: { name: string; graph: ReturnType<typeof parseGraph> } | null;
}

/**
 * Ask the model for one flow, and refuse it unless it survives the same gate
 * publishing uses.
 *
 * `validateGraph` is the whole point of running the model at all: it is what
 * makes a generated flow safe to show. An unreachable block, two Start blocks,
 * a question with nowhere to store its answer — any of those and the draft is
 * dropped here rather than presented to somebody as a suggestion.
 */
async function draftFlow(
  companyId: string,
  provider: Awaited<ReturnType<typeof getChatProviderAsync>>,
  cluster: QuestionCluster,
): Promise<DraftAttempt> {
  let usage: DraftAttempt['usage'] = null;
  try {
    const result = await provider.provider.complete({
      model: provider.model,
      messages: [
        { role: 'system', content: SUGGESTION_SYSTEM_PROMPT },
        { role: 'user', content: buildSuggestionPrompt(cluster) },
      ],
      temperature: 0.2,
      maxTokens: 1600,
    });
    usage = {
      model: provider.model,
      input: result.usage.inputTokens,
      output: result.usage.outputTokens,
    };

    const parsed = parseJsonBlock(result.text);
    const sanitised = parsed ? sanitiseSuggestedFlow(parsed) : null;
    if (!sanitised) {
      logger.warn('A drafted flow was not usable and was discarded', { companyId, topic: cluster.key });
      return { usage, flow: null };
    }

    const graph = parseGraph(sanitised.graph);
    const problems = validateGraph(graph);
    if (problems.length > 0) {
      logger.warn('A drafted flow failed validation and was discarded', {
        companyId,
        topic: cluster.key,
        problem: problems[0]?.message,
      });
      return { usage, flow: null };
    }

    return { usage, flow: { name: sanitised.name, graph } };
  } catch (err) {
    logger.warn('Could not draft a flow for this topic', {
      companyId,
      topic: cluster.key,
      error: err instanceof Error ? err.message : String(err),
    });
    return { usage, flow: null };
  }
}

/** Models wrap JSON in prose or fences often enough that this has to be tolerant. */
export function parseJsonBlock(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}
