'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole, getSessionUser } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { encryptSecret } from '@/lib/crypto';
import { parseGraph, type FlowGraph } from '@/lib/flows/types';
import { getCompanyId } from './data';
import { findTemplate, planGraphSave, planVersionRestore, validateGraph } from './flow-graph';

/**
 * Write side of the flow builder.
 *
 * TENANT ISOLATION: every statement carries `.eq('company_id', companyId)` with
 * the id read from the SESSION, never from the form. Ids that arrive from the
 * client (flow id, trigger id, intent id) are only ever used as an *additional*
 * filter, so a uuid belonging to another company matches zero rows instead of
 * updating someone else's flow.
 */

export type ActionState = { error?: string; ok?: boolean };

const FLOWS_PATH = '/company/flows';
const INTENTS_PATH = '/company/intents';

const uuid = z.string().uuid();
const optText = z.preprocess((x) => (x === '' || x == null ? undefined : x), z.string().optional());

const graphSchema = z.object({
  nodes: z.array(z.unknown()).max(500, 'A flow can hold at most 500 blocks.'),
  edges: z.array(z.unknown()).max(1500, 'A flow can hold at most 1500 connections.'),
});

/** Confirms the flow belongs to the caller's company and returns its row. */
async function ownedFlow(flowId: string) {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('flows')
    .select('id,name,description,status,graph_json,channels,priority,version,bot_id')
    .eq('company_id', companyId)
    .eq('id', flowId)
    .maybeSingle();
  if (!data) return null;
  return { companyId, sb, row: data as Record<string, unknown> };
}

function revalidateFlow(flowId?: string) {
  revalidatePath(FLOWS_PATH);
  if (flowId) revalidatePath(`${FLOWS_PATH}/${flowId}`);
}

// ---------------------------------------------------------------------------
// Create / duplicate / delete
// ---------------------------------------------------------------------------
const createSchema = z.object({
  name: z.string().trim().min(1, 'Give the flow a name.').max(120),
  description: optText,
  templateKey: optText,
});

export type CreateFlowState = ActionState & { flowId?: string };

export async function createFlowAction(
  _prev: CreateFlowState,
  formData: FormData,
): Promise<CreateFlowState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid flow.' };
  const { name, description, templateKey } = parsed.data;

  const template = templateKey ? findTemplate(templateKey) : null;
  if (templateKey && !template) return { error: 'That template no longer exists.' };
  const graph: FlowGraph = template ? template.build() : { nodes: [], edges: [] };

  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('flows')
    .insert({
      company_id: companyId,
      name,
      description: description ?? template?.description ?? null,
      status: 'draft',
      graph_json: graph,
      channels: [],
      priority: 0,
      version: 1,
    })
    .select('id')
    .single();
  if (error) return { error: error.message };

  const flowId = (data as { id: string }).id;

  // A template with a suggested trigger is useless until the trigger exists, so
  // seed it (inactive flows never fire, and the flow starts as a draft).
  if (template?.trigger) {
    await sb.from('flow_triggers').insert({
      company_id: companyId,
      flow_id: flowId,
      type: template.trigger.type,
      match_value: template.trigger.matchValue,
      match_mode: template.trigger.matchMode,
      channels: [],
      is_active: true,
    });
  }

  revalidateFlow(flowId);
  return { ok: true, flowId };
}

export async function duplicateFlowAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const id = uuid.safeParse(formData.get('id'));
  if (!id.success) return;
  const owned = await ownedFlow(id.data);
  if (!owned) return;
  const { companyId, sb, row } = owned;

  const { data } = await sb
    .from('flows')
    .insert({
      company_id: companyId,
      bot_id: (row.bot_id as string) ?? null,
      name: `${row.name as string} (copy)`,
      description: (row.description as string) ?? null,
      // A copy always starts as a draft — duplicating a live flow must not
      // silently double every trigger that matched the original.
      status: 'draft',
      graph_json: row.graph_json ?? { nodes: [], edges: [] },
      channels: (row.channels as string[]) ?? [],
      priority: (row.priority as number) ?? 0,
      version: 1,
    })
    .select('id')
    .single();

  const newId = (data as { id: string } | null)?.id;
  if (newId) {
    const { data: triggers } = await sb
      .from('flow_triggers')
      .select('type,match_value,match_mode,channels')
      .eq('company_id', companyId)
      .eq('flow_id', id.data);
    const rows = ((triggers ?? []) as Record<string, unknown>[]).map((t) => ({
      company_id: companyId,
      flow_id: newId,
      type: t.type as string,
      match_value: (t.match_value as string) ?? '',
      match_mode: (t.match_mode as string) ?? 'contains',
      channels: (t.channels as string[]) ?? [],
      // Copied triggers arrive switched off so two flows never race for the
      // same keyword the moment the copy is published.
      is_active: false,
    }));
    if (rows.length) await sb.from('flow_triggers').insert(rows);
  }

  revalidateFlow(newId);
}

export async function deleteFlowAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const id = uuid.safeParse(formData.get('id'));
  if (!id.success) return;
  const sb = createSupabaseServiceClient();
  await sb.from('flows').delete().eq('company_id', companyId).eq('id', id.data);
  revalidateFlow();
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------
const metaSchema = z.object({
  flowId: uuid,
  name: z.string().trim().min(1, 'Give the flow a name.').max(120),
  description: z.string().trim().max(500).optional().default(''),
  channels: z.array(z.string().max(40)).max(20).optional().default([]),
  priority: z.number().int().min(-100).max(100).optional().default(0),
});

export async function updateFlowMetaAction(input: unknown): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const parsed = metaSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid details.' };
  const { flowId, name, description, channels, priority } = parsed.data;
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { error } = await sb
    .from('flows')
    .update({
      name,
      description: description || null,
      channels,
      priority,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', companyId)
    .eq('id', flowId);
  if (error) return { error: error.message };
  revalidateFlow(flowId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Saving the graph
// ---------------------------------------------------------------------------
const saveSchema = z.object({
  flowId: uuid,
  graph: graphSchema,
  /**
   * `true` writes the previous graph to `flow_versions` and bumps
   * `flows.version` — that is what makes an edit undoable. The builder's
   * debounced autosave passes `false`, because one restore point per keystroke
   * would bury the useful ones.
   */
  snapshot: z.boolean().optional().default(true),
});

export type SaveGraphState = ActionState & { version?: number; savedAt?: string };

export async function saveFlowGraphAction(input: unknown): Promise<SaveGraphState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid graph.' };
  const { flowId, snapshot } = parsed.data;
  const nextGraph = parseGraph(parsed.data.graph);

  const owned = await ownedFlow(flowId);
  if (!owned) return { error: 'Flow not found.' };
  const { companyId, sb, row } = owned;

  const currentVersion = (row.version as number) ?? 1;
  const currentGraph = parseGraph(row.graph_json);
  const now = new Date().toISOString();

  if (!snapshot) {
    const { error } = await sb
      .from('flows')
      .update({ graph_json: nextGraph, updated_at: now })
      .eq('company_id', companyId)
      .eq('id', flowId);
    if (error) return { error: error.message };
    return { ok: true, version: currentVersion, savedAt: now };
  }

  const plan = planGraphSave({ version: currentVersion, graph: currentGraph }, nextGraph);
  const user = await getSessionUser();

  // Snapshot first: if the update below fails, the history still describes a
  // graph that really existed.
  await sb.from('flow_versions').upsert(
    {
      flow_id: flowId,
      company_id: companyId,
      version: plan.snapshot.version,
      graph_json: plan.snapshot.graph,
      created_by: user?.userId ?? null,
    },
    { onConflict: 'flow_id,version' },
  );

  const { error } = await sb
    .from('flows')
    .update({ graph_json: plan.graph, version: plan.nextVersion, updated_at: now })
    .eq('company_id', companyId)
    .eq('id', flowId);
  if (error) return { error: error.message };

  revalidateFlow(flowId);
  return { ok: true, version: plan.nextVersion, savedAt: now };
}

export type PublishState = ActionState & { problems?: string[]; status?: string };

/**
 * Publish gate. A live flow runs ahead of the AI on every matching message, so a
 * broken graph is a broken product — the problems come back as a readable list
 * and nothing is written until they are fixed.
 */
export async function publishFlowAction(input: unknown): Promise<PublishState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const parsed = z
    .object({ flowId: uuid, graph: graphSchema.optional() })
    .safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid request.' };

  const owned = await ownedFlow(parsed.data.flowId);
  if (!owned) return { error: 'Flow not found.' };
  const { companyId, sb, row } = owned;

  // Publish validates the graph the editor is showing, when it sent one — so a
  // user cannot publish an older saved copy by clicking fast.
  const graph = parsed.data.graph ? parseGraph(parsed.data.graph) : parseGraph(row.graph_json);
  const problems = validateGraph(graph).map((p) => p.message);
  if (problems.length > 0) {
    return { error: 'This flow is not ready to go live yet.', problems };
  }

  const currentVersion = (row.version as number) ?? 1;
  const user = await getSessionUser();
  await sb.from('flow_versions').upsert(
    {
      flow_id: parsed.data.flowId,
      company_id: companyId,
      version: currentVersion,
      graph_json: parseGraph(row.graph_json),
      created_by: user?.userId ?? null,
    },
    { onConflict: 'flow_id,version' },
  );

  const { error } = await sb
    .from('flows')
    .update({
      graph_json: graph,
      status: 'live',
      version: currentVersion + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', companyId)
    .eq('id', parsed.data.flowId);
  if (error) return { error: error.message };

  revalidateFlow(parsed.data.flowId);
  return { ok: true, status: 'live' };
}

export async function setFlowStatusAction(input: unknown): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const parsed = z
    .object({ flowId: uuid, status: z.enum(['draft', 'live', 'paused']) })
    .safeParse(input);
  if (!parsed.success) return { error: 'Invalid status.' };
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { error } = await sb
    .from('flows')
    .update({ status: parsed.data.status, updated_at: new Date().toISOString() })
    .eq('company_id', companyId)
    .eq('id', parsed.data.flowId);
  if (error) return { error: error.message };
  revalidateFlow(parsed.data.flowId);
  return { ok: true };
}

/** Form wrapper for the list page's pause / publish / resume buttons. */
export async function toggleFlowStatusAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const id = uuid.safeParse(formData.get('id'));
  const status = z.enum(['draft', 'live', 'paused']).safeParse(formData.get('status'));
  if (!id.success || !status.success) return;

  if (status.data === 'live') {
    // Going live from the list still has to pass the same gate as the builder.
    await publishFlowAction({ flowId: id.data });
    return;
  }
  await setFlowStatusAction({ flowId: id.data, status: status.data });
}

export type RestoreState = ActionState & {
  version?: number;
  /** Returned so the open editor can swap its canvas to the restored graph. */
  graph?: FlowGraph;
};

export async function restoreFlowVersionAction(input: unknown): Promise<RestoreState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const parsed = z.object({ flowId: uuid, version: z.number().int().min(1) }).safeParse(input);
  if (!parsed.success) return { error: 'Invalid version.' };

  const owned = await ownedFlow(parsed.data.flowId);
  if (!owned) return { error: 'Flow not found.' };
  const { companyId, sb, row } = owned;

  const { data: target } = await sb
    .from('flow_versions')
    .select('version,graph_json')
    .eq('company_id', companyId)
    .eq('flow_id', parsed.data.flowId)
    .eq('version', parsed.data.version)
    .maybeSingle();
  if (!target) return { error: 'That version is no longer available.' };

  const plan = planVersionRestore(
    { version: (row.version as number) ?? 1, graph: parseGraph(row.graph_json) },
    {
      version: (target as Record<string, unknown>).version as number,
      graph: parseGraph((target as Record<string, unknown>).graph_json),
    },
  );

  const user = await getSessionUser();
  await sb.from('flow_versions').upsert(
    {
      flow_id: parsed.data.flowId,
      company_id: companyId,
      version: plan.snapshot.version,
      graph_json: plan.snapshot.graph,
      created_by: user?.userId ?? null,
    },
    { onConflict: 'flow_id,version' },
  );

  const { error } = await sb
    .from('flows')
    .update({
      graph_json: plan.graph,
      version: plan.nextVersion,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', companyId)
    .eq('id', parsed.data.flowId);
  if (error) return { error: error.message };

  revalidateFlow(parsed.data.flowId);
  return { ok: true, version: plan.nextVersion, graph: plan.graph };
}

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------
const triggerSchema = z.object({
  id: z.string().uuid().optional(),
  flowId: uuid,
  type: z.enum(['keyword', 'referral', 'ad', 'comment', 'intent', 'welcome', 'event']),
  matchValue: z.string().trim().max(200).optional().default(''),
  matchMode: z.enum(['exact', 'contains', 'starts_with', 'regex']).optional().default('contains'),
  channels: z.array(z.string().max(40)).max(20).optional().default([]),
  isActive: z.boolean().optional().default(true),
});

export async function saveFlowTriggerAction(input: unknown): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const parsed = triggerSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid trigger.' };
  const v = parsed.data;

  // A welcome trigger fires on the first message whatever it says, so it is the
  // only type that legitimately carries no value.
  if (v.type !== 'welcome' && !v.matchValue) {
    return { error: 'Tell us what to match on — a keyword, ref, ad id, intent, or event name.' };
  }
  if (v.matchMode === 'regex') {
    try {
      new RegExp(v.matchValue);
    } catch {
      return { error: 'That is not a valid regular expression.' };
    }
  }

  const owned = await ownedFlow(v.flowId);
  if (!owned) return { error: 'Flow not found.' };
  const { companyId, sb } = owned;

  const payload = {
    company_id: companyId,
    flow_id: v.flowId,
    type: v.type,
    match_value: v.matchValue,
    match_mode: v.matchMode,
    channels: v.channels,
    is_active: v.isActive,
  };

  if (v.id) {
    const { error } = await sb
      .from('flow_triggers')
      .update(payload)
      .eq('company_id', companyId)
      .eq('id', v.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await sb.from('flow_triggers').insert(payload);
    if (error) return { error: error.message };
  }

  revalidateFlow(v.flowId);
  return { ok: true };
}

export async function deleteFlowTriggerAction(input: unknown): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const parsed = z.object({ id: uuid, flowId: uuid }).safeParse(input);
  if (!parsed.success) return { error: 'Invalid trigger.' };
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { error } = await sb
    .from('flow_triggers')
    .delete()
    .eq('company_id', companyId)
    .eq('id', parsed.data.id);
  if (error) return { error: error.message };
  revalidateFlow(parsed.data.flowId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Intents
// ---------------------------------------------------------------------------
const intentSchema = z.object({
  id: z.string().uuid().optional(),
  name: z
    .string()
    .trim()
    .min(1, 'Give the intent a name.')
    .max(60)
    .regex(/^[a-z0-9_.-]+$/i, 'Use letters, numbers, dashes, dots or underscores.'),
  description: z.string().trim().max(300).optional().default(''),
  examples: z.array(z.string().trim().min(1).max(200)).max(100).optional().default([]),
  provider: z.enum(['builtin', 'wit', 'intnt']).optional().default('builtin'),
  isActive: z.boolean().optional().default(true),
});

export async function saveIntentAction(input: unknown): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const parsed = intentSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid intent.' };
  const v = parsed.data;
  if (v.examples.length < 2) {
    return { error: 'Add at least two example phrases so the classifier has something to learn from.' };
  }

  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const payload = {
    company_id: companyId,
    name: v.name,
    description: v.description || null,
    examples: v.examples,
    provider: v.provider,
    is_active: v.isActive,
  };

  if (v.id) {
    const { error } = await sb
      .from('bot_intents')
      .update(payload)
      .eq('company_id', companyId)
      .eq('id', v.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await sb.from('bot_intents').insert(payload);
    if (error) {
      return {
        error: /duplicate|unique/i.test(error.message)
          ? 'You already have an intent with that name.'
          : error.message,
      };
    }
  }

  revalidatePath(INTENTS_PATH);
  return { ok: true };
}

export async function deleteIntentAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const id = uuid.safeParse(formData.get('id'));
  if (!id.success) return;
  const sb = createSupabaseServiceClient();
  await sb.from('bot_intents').delete().eq('company_id', companyId).eq('id', id.data);
  revalidatePath(INTENTS_PATH);
}

// ---------------------------------------------------------------------------
// NLU settings
// ---------------------------------------------------------------------------
const nluSchema = z.object({
  provider: z.enum(['builtin', 'wit', 'intnt']),
  /** Blank means "leave the stored token alone" — the UI never receives it back. */
  token: z.string().trim().max(400).optional().default(''),
  clearToken: z.boolean().optional().default(false),
});

export async function saveNluSettingsAction(input: unknown): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const parsed = nluSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid settings.' };
  const { provider, token, clearToken } = parsed.data;

  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();

  const { data: existing } = await sb
    .from('nlu_settings')
    .select('token_encrypted')
    .eq('company_id', companyId)
    .maybeSingle();
  const currentToken = (existing as { token_encrypted?: string } | null)?.token_encrypted ?? null;

  if (provider !== 'builtin' && !token && !currentToken) {
    return { error: 'That provider needs an access token before it can classify anything.' };
  }

  let tokenEncrypted: string | null = currentToken;
  if (clearToken) tokenEncrypted = null;
  else if (token) tokenEncrypted = encryptSecret(token);

  const { error } = await sb.from('nlu_settings').upsert(
    {
      company_id: companyId,
      provider,
      token_encrypted: tokenEncrypted,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'company_id' },
  );
  if (error) return { error: error.message };

  revalidatePath(INTENTS_PATH);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Intent test bench
// ---------------------------------------------------------------------------
export type TestIntentState = ActionState & {
  phrase?: string;
  intent?: string | null;
  confidence?: number;
  source?: 'provider' | 'builtin' | 'none';
};

interface IntentSample {
  id: string;
  name: string;
  examples: string[];
}

type ClassifyResult = { intent: string | null; confidence: number } | null;

/**
 * Thin wrapper around the real classifier.
 *
 * `src/lib/flows/nlu.ts` belongs to the flow runtime, not to this module, so it
 * is loaded through a computed specifier (which the bundler resolves to a
 * directory context rather than a hard dependency) inside a try/catch. If it is
 * ever renamed, moved, or throws, the local matcher below answers instead and
 * the test bench keeps working rather than 500-ing.
 *
 * `null` here means "could not ask the real classifier"; a *result* carrying
 * `intent: null` means the real classifier ran and found no match.
 */
async function classifyViaModule(
  phrase: string,
  companyId: string,
  intents: IntentSample[],
): Promise<ClassifyResult> {
  try {
    const moduleName = 'nlu';
    const mod = (await import(`../../lib/flows/${moduleName}`)) as {
      classifyIntent?: (params: {
        companyId: string;
        text: string;
        intents?: IntentSample[];
      }) => Promise<unknown>;
    };
    if (typeof mod?.classifyIntent !== 'function') return null;
    // Intents are passed in so the classifier does not re-query what we just read.
    const raw = await mod.classifyIntent({ companyId, text: phrase, intents });
    if (raw === null || raw === undefined) return { intent: null, confidence: 0 };
    if (typeof raw !== 'object') return null;
    const match = raw as { name?: string; intent?: string; confidence?: number };
    return { intent: match.name ?? match.intent ?? null, confidence: Number(match.confidence) || 0 };
  } catch {
    return null;
  }
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'can', 'do', 'does', 'for', 'from', 'have', 'how',
  'i', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'please', 'the', 'to', 'want', 'was',
  'what', 'when', 'where', 'which', 'who', 'will', 'with', 'you', 'your',
]);

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

/**
 * Fallback classifier: bag-of-words overlap against each intent's examples,
 * scored by the best-matching single example. Deliberately simple — it exists so
 * the "test a phrase" box still answers when the runtime classifier cannot be
 * reached, not to be state of the art. When it runs, the UI says so.
 */
function classifyBuiltin(phrase: string, intents: IntentSample[]): ClassifyResult {
  const words = tokenise(phrase);
  if (words.length === 0) return { intent: null, confidence: 0 };
  const asked = new Set(words);

  let best: { name: string; score: number } | null = null;
  for (const intent of intents) {
    for (const example of intent.examples) {
      const exampleWords = tokenise(example);
      if (exampleWords.length === 0) continue;
      const exampleSet = new Set(exampleWords);
      let shared = 0;
      for (const w of exampleSet) if (asked.has(w)) shared += 1;
      // Dice coefficient — rewards overlap without punishing a long example.
      const score = (2 * shared) / (exampleSet.size + asked.size);
      if (!best || score > best.score) best = { name: intent.name, score };
    }
  }
  if (!best || best.score < 0.34) return { intent: null, confidence: best?.score ?? 0 };
  return { intent: best.name, confidence: Math.min(1, best.score) };
}

export async function testIntentAction(
  _prev: TestIntentState,
  formData: FormData,
): Promise<TestIntentState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const parsed = z
    .object({ phrase: z.string().trim().min(1, 'Type a phrase to test.').max(500) })
    .safeParse({ phrase: formData.get('phrase') });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Type a phrase to test.' };
  const phrase = parsed.data.phrase;

  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data: intentRows } = await sb
    .from('bot_intents')
    .select('id,name,examples,is_active')
    .eq('company_id', companyId)
    .limit(300);

  const intents: IntentSample[] = ((intentRows ?? []) as Record<string, unknown>[])
    .filter((r) => r.is_active !== false)
    .map((r) => ({
      id: r.id as string,
      name: r.name as string,
      examples: (r.examples as string[]) ?? [],
    }));

  if (intents.length === 0) {
    return { phrase, intent: null, confidence: 0, source: 'none', ok: true };
  }

  // The runtime classifier reads this company's provider and token itself, so
  // the token is never decrypted here.
  const viaModule = await classifyViaModule(phrase, companyId, intents);
  if (viaModule) {
    return { ...viaModule, phrase, source: 'provider', ok: true };
  }

  const local = classifyBuiltin(phrase, intents) ?? { intent: null, confidence: 0 };
  return { ...local, phrase, source: 'builtin', ok: true };
}
