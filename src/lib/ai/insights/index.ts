import { createSupabaseServiceClient } from '@/lib/db/server';
import { logger } from '@/lib/logger';
import { tokenize } from '@/lib/flows/nlu';
import { getChatProviderAsync } from '@/lib/ai/providers';
import { logAiUsage } from '@/lib/ai/usage';
import { buildEvidence, MIN_CONVERSATIONS_FOR_INSIGHTS, type Evidence } from './evidence';
import { dedupeFindings, deterministicFindings, sanitiseModelFindings, type Finding } from './rules';

export type { Finding } from './rules';
export { MIN_CONVERSATIONS_FOR_INSIGHTS } from './evidence';

export interface InsightsRunResult {
  status: 'ok' | 'skipped' | 'failed';
  note?: string;
  findings: number;
  usedModel: boolean;
}

const MAX_ROWS = 8000;

/**
 * Generate this company's insights for the last `days` days.
 *
 * Two passes. The arithmetic pass turns counted facts into findings and is the
 * only thing allowed to state a number. The model pass reads the questions the
 * assistant could not answer and groups them into something an owner can act
 * on — the one part of this that genuinely needs language rather than counting.
 * With no AI provider configured the arithmetic pass still runs on its own.
 */
export async function generateInsights(companyId: string, days = 30): Promise<InsightsRunResult> {
  const sb = createSupabaseServiceClient();
  const now = new Date();
  const periodStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  // The comparison window doubles the range so "up from last month" is real.
  const loadFrom = new Date(now.getTime() - days * 2 * 24 * 60 * 60 * 1000).toISOString();

  const { data: runRow } = await sb
    .from('ai_insight_runs')
    .insert({
      company_id: companyId,
      period_days: days,
      period_start: periodStart.toISOString(),
      period_end: now.toISOString(),
      status: 'running',
    })
    .select('id')
    .maybeSingle();
  const runId = (runRow as { id: string } | null)?.id ?? null;

  const finish = async (
    status: 'ok' | 'failed' | 'skipped',
    note?: string,
    usage?: { model: string; input: number; output: number },
  ) => {
    if (!runId) return;
    await sb
      .from('ai_insight_runs')
      .update({
        status,
        note: note ?? null,
        model: usage?.model ?? null,
        input_tokens: usage?.input ?? 0,
        output_tokens: usage?.output ?? 0,
        finished_at: new Date().toISOString(),
      })
      .eq('id', runId);
  };

  try {
    const evidence = await loadEvidence(companyId, days, now, loadFrom);

    if (evidence.thin) {
      await finish(
        'skipped',
        `Only ${evidence.totals.conversations} conversations in the period — at least ${MIN_CONVERSATIONS_FOR_INSIGHTS} are needed before a difference means anything.`,
      );
      return {
        status: 'skipped',
        note: 'Not enough conversations yet.',
        findings: 0,
        usedModel: false,
      };
    }

    const findings: Finding[] = [...deterministicFindings(evidence)];
    let usedModel = false;
    let usage: { model: string; input: number; output: number } | undefined;

    if (evidence.unanswered.length >= 5) {
      const modelPass = await askModelForKnowledgeGaps(companyId, evidence);
      if (modelPass) {
        findings.push(...modelPass.findings);
        usedModel = true;
        usage = modelPass.usage;
      }
    }

    const deduped = dedupeFindings(findings);
    await persistFindings(companyId, runId, deduped, periodStart, now);
    await finish('ok', undefined, usage);

    return { status: 'ok', findings: deduped.length, usedModel };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Insights run failed', { companyId, error: message });
    await finish('failed', message.slice(0, 400));
    return { status: 'failed', note: message, findings: 0, usedModel: false };
  }
}

async function loadEvidence(
  companyId: string,
  days: number,
  now: Date,
  loadFrom: string,
): Promise<Evidence> {
  const sb = createSupabaseServiceClient();

  const [convoRes, messageRes, ratingRes, flowEventRes, flowRes, slaRes, unansweredRes] = await Promise.all([
    sb
      .from('conversations')
      .select('id,channel,status,started_at')
      .eq('company_id', companyId)
      .gte('started_at', loadFrom)
      .limit(MAX_ROWS),
    sb
      .from('messages')
      .select('conversation_id,sender_type,content_text,created_at')
      .eq('company_id', companyId)
      .eq('sender_type', 'visitor')
      .gte('created_at', loadFrom)
      .limit(MAX_ROWS),
    sb
      .from('conversation_ratings')
      .select('rating,channel,created_at')
      .eq('company_id', companyId)
      .gte('created_at', loadFrom)
      .limit(MAX_ROWS),
    sb
      .from('flow_node_events')
      .select('flow_id,node_id,node_type,event,conversation_id')
      .eq('company_id', companyId)
      .gte('created_at', loadFrom)
      .limit(MAX_ROWS),
    sb.from('flows').select('id,name').eq('company_id', companyId).limit(200),
    sb
      .from('sla_states')
      .select('first_response_at,first_response_breached,resolution_breached')
      .eq('company_id', companyId)
      .gte('started_at', loadFrom)
      .limit(MAX_ROWS),
    // The questions the assistant itself flagged as unanswered.
    sb
      .from('answer_quality_logs')
      .select('question,failure_reason,confidence_score,created_at')
      .eq('company_id', companyId)
      .gte('created_at', new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString())
      .not('failure_reason', 'is', null)
      .order('created_at', { ascending: false })
      .limit(200),
  ]);

  const unanswered = ((unansweredRes.data ?? []) as unknown as Array<{ question: string | null }>)
    .map((r) => (r.question ?? '').trim())
    .filter((q) => q.length > 3);

  const flowNames = new Map(
    ((flowRes.data ?? []) as unknown as Array<{ id: string; name: string }>).map((f) => [f.id, f.name]),
  );

  return buildEvidence(
    {
      periodDays: days,
      now,
      conversations: (convoRes.data ?? []) as never,
      messages: (messageRes.data ?? []) as never,
      ratings: (ratingRes.data ?? []) as never,
      flowEvents: (flowEventRes.data ?? []) as never,
      slaStates: (slaRes.data ?? []) as never,
      flowNames,
      unanswered,
    },
    tokenize,
  );
}

const SYSTEM_PROMPT = `You group customer questions that a business's AI assistant failed to answer.

You will be given a list of real questions. Group them into at most 4 themes.

Rules:
- Report only what the questions themselves show. Never invent a statistic, a percentage or a trend.
- Each theme must be something the business owner can fix by adding information, not a vague observation.
- Write for a shop owner, not an engineer. Short sentences, no jargon.
- "examples" must be exact strings copied from the list you were given.

Reply with JSON only, in this shape:
{"findings":[{"title":"...","detail":"...","recommendation":"...","category":"knowledge_gap","severity":"info","examples":["..."]}]}`;

async function askModelForKnowledgeGaps(
  companyId: string,
  evidence: Evidence,
): Promise<{ findings: Finding[]; usage: { model: string; input: number; output: number } } | null> {
  const resolved = await getChatProviderAsync(companyId);
  // The mock provider returns canned text; a fabricated insight is worse than none.
  if (resolved.apiType === 'mock') return null;

  const questions = evidence.unanswered.slice(0, 40);
  const userPrompt = [
    `Questions the assistant could not answer in the last ${evidence.periodDays} days:`,
    ...questions.map((q, i) => `${i + 1}. ${q}`),
    '',
    `For context, the words customers used most: ${evidence.topics.map((t) => t.term).slice(0, 12).join(', ') || 'none'}.`,
  ].join('\n');

  try {
    const result = await resolved.provider.complete({
      model: resolved.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
      maxTokens: 900,
    });

    const parsed = parseJsonBlock(result.text);
    if (!parsed) return null;

    await logAiUsage({
      companyId,
      provider: resolved.provider.name,
      model: resolved.model,
      operationType: 'insights',
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    });

    return {
      findings: sanitiseModelFindings(parsed, questions),
      usage: {
        model: resolved.model,
        input: result.usage.inputTokens,
        output: result.usage.outputTokens,
      },
    };
  } catch (err) {
    logger.warn('Insights model pass failed; keeping the counted findings', {
      companyId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
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

async function persistFindings(
  companyId: string,
  runId: string | null,
  findings: Finding[],
  periodStart: Date,
  periodEnd: Date,
): Promise<void> {
  const sb = createSupabaseServiceClient();

  for (const f of findings) {
    // The partial unique index covers open findings only, so a repeat run
    // refreshes the open one and never resurrects something already dismissed.
    const { data: existing } = await sb
      .from('ai_insights')
      .select('id,status')
      .eq('company_id', companyId)
      .eq('fingerprint', f.fingerprint)
      .in('status', ['new', 'acknowledged'])
      .maybeSingle();

    const row = {
      company_id: companyId,
      run_id: runId,
      category: f.category,
      severity: f.severity,
      title: f.title,
      detail: f.detail,
      recommendation: f.recommendation ?? null,
      evidence_json: f.evidence,
      action_href: f.actionHref ?? null,
      action_label: f.actionLabel ?? null,
      fingerprint: f.fingerprint,
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { error } = existing
      ? await sb
          .from('ai_insights')
          .update(row)
          .eq('company_id', companyId)
          .eq('id', (existing as { id: string }).id)
      : await sb.from('ai_insights').insert(row);

    if (error && (error as { code?: string }).code !== '23505') {
      logger.warn('Could not save an insight', { companyId, error: error.message });
    }
  }
}
