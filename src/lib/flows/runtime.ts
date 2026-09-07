import { createSupabaseServiceClient } from '@/lib/db/server';
import { logger } from '@/lib/logger';
import type { OutboundBlock } from '@/lib/channels/types';
import { runFlow, type EngineResult, type FlowEffect } from './engine';
import { startSlaClock } from '@/lib/sla';
import { loadFlowById, matchTrigger } from './triggers';
import type { FlowRecord, FlowState } from './types';

export interface FlowTurnParams {
  companyId: string;
  botId: string | null;
  conversationId: string;
  channel: string;
  text: string;
  visitorId: string;
  contactName?: string | null;
  referral?: string | null;
  isFirstMessage?: boolean;
  kind?: 'message' | 'comment';
  eventName?: string | null;
}

export interface FlowTurnResult {
  flowId: string;
  blocks: OutboundBlock[];
  /** The flow owns this turn — the AI should not also answer. */
  handled: boolean;
  handoffToAi: boolean;
  aiInstruction?: string;
  handoffToHuman: boolean;
}

interface SessionRow {
  id: string;
  flow_id: string;
  awaiting_node_id: string | null;
  state_json: FlowState;
}

async function loadSession(conversationId: string): Promise<SessionRow | null> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('flow_sessions')
    .select('id,flow_id,awaiting_node_id,state_json')
    .eq('conversation_id', conversationId)
    .eq('status', 'running')
    .maybeSingle();
  return (data as SessionRow | null) ?? null;
}

/**
 * Run one conversational turn through the flow engine.
 *
 * Returns null when no flow is involved, which is the common case — the cost of
 * that path is one indexed session lookup plus a cached trigger match, so an
 * account with no flows pays almost nothing.
 */
export async function runFlowTurn(params: FlowTurnParams): Promise<FlowTurnResult | null> {
  try {
    const session = await loadSession(params.conversationId);

    if (session) {
      const flow = await loadFlowById(params.companyId, session.flow_id);
      if (!flow) {
        await cancelSession(session.id);
        return null;
      }
      // A paused or unpublished flow must not keep steering live conversations.
      if (flow.status !== 'live') {
        await cancelSession(session.id);
        return null;
      }
      return executeAndPersist({
        params,
        flow,
        sessionId: session.id,
        startNodeId: session.awaiting_node_id,
        state: seedState(session.state_json, params),
        input: params.text,
      });
    }

    const hit = await matchTrigger({
      companyId: params.companyId,
      botId: params.botId,
      channel: params.channel,
      text: params.text,
      referral: params.referral,
      isFirstMessage: params.isFirstMessage,
      kind: params.kind,
      eventName: params.eventName,
    });
    if (!hit) return null;

    const sessionId = await createSession(params, hit.flow.id);
    if (!sessionId) return null;

    logger.info('Flow triggered', { flowId: hit.flow.id, reason: hit.reason, channel: params.channel });
    return executeAndPersist({
      params,
      flow: hit.flow,
      sessionId,
      startNodeId: null,
      state: seedState({}, params),
      input: null,
    });
  } catch (err) {
    // A broken flow must never stop the assistant from answering.
    logger.error('Flow turn failed; falling back to the AI', {
      conversationId: params.conversationId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Built-ins every flow can reference with {{...}} without collecting them. */
function seedState(existing: FlowState, params: FlowTurnParams): FlowState {
  return {
    ...existing,
    contact_name: params.contactName ?? existing.contact_name ?? '',
    contact_id: params.visitorId,
    channel: params.channel,
    last_message: params.text,
  };
}

async function createSession(params: FlowTurnParams, flowId: string): Promise<string | null> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('flow_sessions')
    .insert({
      company_id: params.companyId,
      conversation_id: params.conversationId,
      flow_id: flowId,
      status: 'running',
      state_json: {},
    })
    .select('id')
    .maybeSingle();
  if (error) {
    // 23505 = another delivery of the same message already opened the session.
    if ((error as { code?: string }).code !== '23505') {
      logger.warn('Could not open a flow session', { error: error.message });
    }
    return null;
  }
  return (data as { id: string } | null)?.id ?? null;
}

async function cancelSession(sessionId: string): Promise<void> {
  const sb = createSupabaseServiceClient();
  await sb.from('flow_sessions').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', sessionId);
}

async function executeAndPersist(input: {
  params: FlowTurnParams;
  flow: FlowRecord;
  sessionId: string;
  startNodeId: string | null;
  state: FlowState;
  input: string | null;
}): Promise<FlowTurnResult> {
  const { params, flow, sessionId } = input;

  let result: EngineResult = await runFlow({
    graph: flow.graph,
    startNodeId: input.startNodeId,
    state: input.state,
    input: input.input,
  });

  let activeFlow = flow;
  const blocks: OutboundBlock[] = [...result.blocks];
  const effects: FlowEffect[] = [...result.effects];

  // A `jump` chains into another flow. Bounded so two flows cannot ping-pong.
  let jumps = 0;
  while (result.jumpFlowId && jumps < 3) {
    jumps += 1;
    const next = await loadFlowById(params.companyId, result.jumpFlowId);
    if (!next || next.status !== 'live') break;
    activeFlow = next;
    result = await runFlow({ graph: next.graph, startNodeId: null, state: result.state, input: null });
    blocks.push(...result.blocks);
    effects.push(...result.effects);
  }

  await applyEffects(params, activeFlow.id, effects, result.state);

  const sb = createSupabaseServiceClient();
  const finished = result.completed && !result.awaitingNodeId;
  await sb
    .from('flow_sessions')
    .update({
      flow_id: activeFlow.id,
      awaiting_node_id: result.awaitingNodeId,
      state_json: result.state,
      status: finished ? 'completed' : 'running',
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId);

  if (finished) {
    await recordNodeEvents(params, activeFlow.id, [
      { type: 'node', nodeId: 'flow', nodeType: 'flow', event: 'entered' },
    ], 'completed');
  }

  return {
    flowId: activeFlow.id,
    blocks,
    handled: blocks.length > 0 || result.handoffToHuman,
    handoffToAi: result.handoffToAi,
    aiInstruction: result.aiInstruction,
    handoffToHuman: result.handoffToHuman,
  };
}

async function applyEffects(
  params: FlowTurnParams,
  flowId: string,
  effects: FlowEffect[],
  state: FlowState,
): Promise<void> {
  const sb = createSupabaseServiceClient();

  const tags = effects.flatMap((e) => (e.type === 'tag' ? e.tags : []));
  const assign = effects.find((e) => e.type === 'assign') as Extract<FlowEffect, { type: 'assign' }> | undefined;
  const handoff = effects.some((e) => e.type === 'handoff');
  const leads = effects.filter((e) => e.type === 'save_lead') as Extract<FlowEffect, { type: 'save_lead' }>[];
  const subscribe = effects.find((e) => e.type === 'subscribe') as
    | Extract<FlowEffect, { type: 'subscribe' }>
    | undefined;

  if (tags.length > 0) {
    // Read-modify-write on a small array column; the conversation row is already
    // hot in cache at this point in the turn.
    const { data } = await sb
      .from('conversations')
      .select('tags')
      .eq('company_id', params.companyId)
      .eq('id', params.conversationId)
      .maybeSingle();
    const current = ((data as { tags?: string[] } | null)?.tags ?? []) as string[];
    const merged = Array.from(new Set([...current, ...tags]));
    if (merged.length !== current.length) {
      await sb
        .from('conversations')
        .update({ tags: merged })
        .eq('company_id', params.companyId)
        .eq('id', params.conversationId);
    }
  }

  if (assign || handoff) {
    const update: Record<string, unknown> = {
      status: handoff ? 'needs_human' : 'human_active',
      ai_enabled: false,
    };
    if (assign?.agentId) {
      // TENANT ISOLATION: only assign to an agent inside this company.
      const { data: member } = await sb
        .from('company_users')
        .select('user_id')
        .eq('company_id', params.companyId)
        .eq('user_id', assign.agentId)
        .maybeSingle();
      if (member) update.assigned_agent_id = assign.agentId;
    }
    await sb
      .from('conversations')
      .update(update)
      .eq('company_id', params.companyId)
      .eq('id', params.conversationId);

    // A flow that hands off starts the same response clock a chat escalation does.
    await startSlaClock({
      companyId: params.companyId,
      conversationId: params.conversationId,
      channel: params.channel,
    });
  }

  for (const lead of leads) {
    if (Object.keys(lead.fields).length === 0) continue;
    await sb.from('leads').insert({
      company_id: params.companyId,
      bot_id: params.botId,
      conversation_id: params.conversationId,
      name: lead.fields.name ?? null,
      email: lead.fields.email ?? null,
      phone: lead.fields.phone ?? null,
      enquiry_type: lead.fields.enquiry_type ?? null,
      message: lead.fields.message ?? null,
      source: `flow:${flowId}`,
    });
  }

  // A `csat` block asked the customer to rate 1-5 and stored the answer in flow
  // state — and nothing ever wrote it down, so a rating collected by a flow was
  // silently discarded. Both places the product reads CSAT from are written
  // here, exactly as the widget's own rating route does.
  if (effects.some((e) => e.type === 'csat')) {
    const rating = Number(state.csat_rating);
    if (Number.isInteger(rating) && rating >= 1 && rating <= 5) {
      const now = new Date().toISOString();
      const { error } = await sb.from('conversation_ratings').upsert(
        {
          company_id: params.companyId,
          conversation_id: params.conversationId,
          bot_id: params.botId,
          visitor_id: params.visitorId,
          channel: params.channel,
          rating,
          updated_at: now,
        },
        { onConflict: 'conversation_id' },
      );
      if (error) logger.warn('Flow CSAT rating not saved', { error: error.message });
      else {
        await sb
          .from('conversations')
          .update({ csat_rating: rating, csat_rated_at: now })
          .eq('company_id', params.companyId)
          .eq('id', params.conversationId);
      }
    }
  }

  if (subscribe) {
    // The subscriptions table ships with the WhatsApp suite; tolerate its absence
    // so a flow using this block still runs on a partially migrated database.
    const { error } = await sb.from('contact_subscriptions').upsert(
      {
        company_id: params.companyId,
        channel: params.channel,
        contact_identifier: params.visitorId,
        opted_in: subscribe.optIn,
        source: `flow:${flowId}`,
        ...(subscribe.optIn ? { opted_in_at: new Date().toISOString() } : { opted_out_at: new Date().toISOString() }),
      },
      { onConflict: 'company_id,channel,contact_identifier' },
    );
    if (error) logger.warn('Subscription update skipped', { error: error.message });
  }

  await recordNodeEvents(params, flowId, effects);
}

async function recordNodeEvents(
  params: FlowTurnParams,
  flowId: string,
  effects: FlowEffect[],
  override?: 'completed',
): Promise<void> {
  const rows = effects
    .filter((e): e is Extract<FlowEffect, { type: 'node' }> => e.type === 'node')
    .map((e) => ({
      company_id: params.companyId,
      flow_id: flowId,
      conversation_id: params.conversationId,
      node_id: e.nodeId,
      node_type: e.nodeType,
      event: override ?? e.event,
    }));
  if (rows.length === 0) return;
  const sb = createSupabaseServiceClient();
  const { error } = await sb.from('flow_node_events').insert(rows);
  if (error) logger.warn('Flow analytics insert failed', { error: error.message });
}

/** Start a named flow for a conversation from outside the message pipeline. */
export async function startFlowForConversation(params: FlowTurnParams & { flowId: string }): Promise<FlowTurnResult | null> {
  const flow = await loadFlowById(params.companyId, params.flowId);
  if (!flow || flow.status !== 'live') return null;
  const existing = await loadSession(params.conversationId);
  if (existing) await cancelSession(existing.id);
  const sessionId = await createSession(params, flow.id);
  if (!sessionId) return null;
  return executeAndPersist({
    params,
    flow,
    sessionId,
    startNodeId: null,
    state: seedState({}, params),
    input: null,
  });
}
