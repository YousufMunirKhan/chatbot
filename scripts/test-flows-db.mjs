// Flow runtime verification against the REAL database.
//
// scripts/test-flows.mjs proves the engine's logic; this proves the parts only a
// database can prove: that the schema in migration 0053 matches what the runtime
// writes, that a session survives a turn and resumes correctly, that the unique
// indexes actually stop a double session, and — the one that matters most —
// that a flow belonging to another company can never run for this one.
//
// Creates its own throwaway company and deletes it at the end.
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { loadTs, makeChecker } from './lib/ts-load.mjs';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local');
  process.exit(1);
}
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

const { check, state } = makeChecker();

// The runtime reaches for Supabase, the logger, crypto, HTTP and the SLA module.
// Only Supabase is real here: this test is about the flow schema, and an SLA
// clock or an outbound HTTP call would just add noise.
const modules = await loadTs(['src/lib/flows/runtime.ts', 'src/lib/flows/triggers.ts'], {
  '@/lib/db/server': `
    import { createClient } from '@supabase/supabase-js';
    const admin = createClient(${JSON.stringify(url)}, ${JSON.stringify(serviceKey)}, { auth: { persistSession: false } });
    export function createSupabaseServiceClient() { return admin; }
  `,
  '@/lib/logger': `export const logger = { info() {}, warn() {}, error() {}, debug() {} };`,
  '@/lib/crypto': `export function encryptSecret(v){return v;} export function decryptSecret(v){return v;}`,
  '@/lib/channels/http': `
    export async function getJson() { return { ok: false, status: 0, body: null }; }
    export async function postJson() { return { ok: false, status: 0, body: null }; }
    export async function request() { return { ok: false, status: 0, body: null }; }
    export function safeUrl(u){ return u; }
  `,
  '@/lib/sla': `
    export async function startSlaClock() { return null; }
    export async function markFirstResponse() {}
    export async function markResolved() {}
  `,
});

const { runFlowTurn } = modules['src/lib/flows/runtime.ts'];
const { invalidateTriggerCache } = modules['src/lib/flows/triggers.ts'];

const node = (id, type, data = {}) => ({ id, type, position: { x: 0, y: 0 }, data });
const edge = (source, target, sourceHandle) => ({ id: `${source}->${target}`, source, target, sourceHandle });

const MENU_GRAPH = {
  nodes: [
    node('start', 'start'),
    node('greet', 'message', { text: 'Hi {{contact_name}}, how can we help?' }),
    node('menu', 'buttons', {
      text: 'Pick one',
      variable: 'topic',
      choices: [
        { id: 'track', label: 'Track my order', value: 'track' },
        { id: 'human', label: 'Talk to a person', value: 'human' },
      ],
    }),
    node('tracked', 'message', { text: 'Your order is out for delivery.' }),
    node('tag', 'tag', { tags: ['flow-tested'] }),
    node('done', 'end', { text: 'Anything else?' }),
    node('handoff', 'handoff', { text: 'Connecting you now.' }),
  ],
  edges: [
    edge('start', 'greet'),
    edge('greet', 'menu'),
    edge('menu', 'tracked', 'track'),
    edge('menu', 'handoff', 'human'),
    edge('tracked', 'tag'),
    edge('tag', 'done'),
  ],
};

let companyId = null;
let otherCompanyId = null;

async function makeCompany(name) {
  const { data, error } = await admin.from('companies').insert({ name }).select('id').single();
  if (error) throw new Error(`company insert failed: ${error.message}`);
  return data.id;
}

async function makeBot(cid, name) {
  const { data, error } = await admin
    .from('bots')
    .insert({ company_id: cid, name, bot_type: 'hybrid_business_assistant', capability_flags: ['help_desk'] })
    .select('id')
    .single();
  if (error) throw new Error(`bot insert failed: ${error.message}`);
  return data.id;
}

async function makeConversation(cid, botId, visitorId) {
  const { data, error } = await admin
    .from('conversations')
    .insert({ company_id: cid, bot_id: botId, channel: 'telegram', visitor_id: visitorId, status: 'ai_active' })
    .select('id')
    .single();
  if (error) throw new Error(`conversation insert failed: ${error.message}`);
  return data.id;
}

async function makeFlow(cid, botId, name, graph, status = 'live') {
  const { data, error } = await admin
    .from('flows')
    .insert({ company_id: cid, bot_id: botId, name, status, graph_json: graph })
    .select('id')
    .single();
  if (error) throw new Error(`flow insert failed: ${error.message}`);
  return data.id;
}

async function makeTrigger(cid, flowId, type, matchValue, matchMode = 'contains') {
  const { error } = await admin
    .from('flow_triggers')
    .insert({ company_id: cid, flow_id: flowId, type, match_value: matchValue, match_mode: matchMode });
  if (error) throw new Error(`trigger insert failed: ${error.message}`);
}

try {
  // --- setup ---------------------------------------------------------------
  companyId = await makeCompany('QA Flows Co');
  otherCompanyId = await makeCompany('QA Flows Other Co');
  const botId = await makeBot(companyId, 'QA Flow Bot');
  const otherBotId = await makeBot(otherCompanyId, 'Other Bot');
  const conversationId = await makeConversation(companyId, botId, 'tg:1001');

  const flowId = await makeFlow(companyId, botId, 'Order menu', MENU_GRAPH);
  await makeTrigger(companyId, flowId, 'keyword', 'order');
  invalidateTriggerCache();

  const turnParams = {
    companyId,
    botId,
    conversationId,
    channel: 'telegram',
    visitorId: 'tg:1001',
    contactName: 'Sara',
  };

  // --- 1. a keyword starts the flow ----------------------------------------
  const first = await runFlowTurn({ ...turnParams, text: 'where is my order', isFirstMessage: true });
  check('a keyword trigger starts the flow', first !== null);
  check('the flow greeted and showed the menu', first?.blocks.length === 2, first?.blocks.map((b) => b.type));
  check('the greeting interpolated the contact name', first?.blocks[0]?.text === 'Hi Sara, how can we help?');
  check('the menu rendered as buttons', first?.blocks[1]?.type === 'buttons');
  check('the flow owns the turn', first?.handled === true && first?.handoffToAi === false);

  // --- 2. the session was persisted and parked on the menu ------------------
  const { data: session } = await admin
    .from('flow_sessions')
    .select('id,flow_id,awaiting_node_id,status,state_json')
    .eq('conversation_id', conversationId)
    .eq('status', 'running')
    .maybeSingle();
  check('a running session exists', Boolean(session));
  check('the session is parked on the menu node', session?.awaiting_node_id === 'menu');
  check('collected state was written', session?.state_json?.contact_name === 'Sara');

  // --- 3. one running session per conversation ------------------------------
  const { error: dupErr } = await admin.from('flow_sessions').insert({
    company_id: companyId,
    conversation_id: conversationId,
    flow_id: flowId,
    status: 'running',
  });
  check('a second running session is rejected by the database', dupErr?.code === '23505', dupErr?.message);

  // --- 4. the answer resumes the flow on the right branch -------------------
  const second = await runFlowTurn({ ...turnParams, text: 'Track my order' });
  check('the answer resumed the flow', second !== null);
  check(
    'the matching branch ran to the end',
    second?.blocks.map((b) => b.text).join(' | ') === 'Your order is out for delivery. | Anything else?',
    second?.blocks,
  );

  const { data: finished } = await admin
    .from('flow_sessions')
    .select('status')
    .eq('conversation_id', conversationId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  check('the session is marked completed', finished?.status === 'completed');

  // --- 5. an action block wrote through to the conversation ------------------
  const { data: convo } = await admin
    .from('conversations')
    .select('tags')
    .eq('id', conversationId)
    .maybeSingle();
  check('the tag block tagged the conversation', (convo?.tags ?? []).includes('flow-tested'));

  // --- 6. analytics were recorded -------------------------------------------
  const { data: events } = await admin
    .from('flow_node_events')
    .select('node_id,event')
    .eq('flow_id', flowId)
    .limit(100);
  check('node events were written', (events ?? []).length > 0);
  check('the menu answer was recorded', (events ?? []).some((e) => e.node_id === 'menu' && e.event === 'answered'));

  // --- 7. TENANT ISOLATION ---------------------------------------------------
  // Another company publishes a flow with the same keyword. It must never run
  // for this company's conversation.
  const otherFlowId = await makeFlow(otherCompanyId, otherBotId, 'Other order menu', MENU_GRAPH);
  await makeTrigger(otherCompanyId, otherFlowId, 'keyword', 'order');
  invalidateTriggerCache();

  const isolationConvo = await makeConversation(companyId, botId, 'tg:1002');
  const isolated = await runFlowTurn({
    ...turnParams,
    conversationId: isolationConvo,
    visitorId: 'tg:1002',
    text: 'order please',
    isFirstMessage: true,
  });
  check('a matching flow still runs for the owning company', isolated !== null);
  const { data: isoSession } = await admin
    .from('flow_sessions')
    .select('flow_id')
    .eq('conversation_id', isolationConvo)
    .maybeSingle();
  check("the other company's flow was NOT used", isoSession?.flow_id === flowId, isoSession?.flow_id);

  // The other company's own conversation must reach its own flow, not ours.
  const otherConvo = await makeConversation(otherCompanyId, otherBotId, 'tg:2001');
  await runFlowTurn({
    companyId: otherCompanyId,
    botId: otherBotId,
    conversationId: otherConvo,
    channel: 'telegram',
    visitorId: 'tg:2001',
    text: 'order status',
    isFirstMessage: true,
  });
  const { data: otherSession } = await admin
    .from('flow_sessions')
    .select('flow_id')
    .eq('conversation_id', otherConvo)
    .maybeSingle();
  check('each company reaches its own flow', otherSession?.flow_id === otherFlowId);

  // --- 8. a paused flow stops steering live conversations -------------------
  const pausedConvo = await makeConversation(companyId, botId, 'tg:1003');
  await admin.from('flows').update({ status: 'paused' }).eq('id', flowId);
  invalidateTriggerCache();
  const paused = await runFlowTurn({
    ...turnParams,
    conversationId: pausedConvo,
    visitorId: 'tg:1003',
    text: 'order please',
    isFirstMessage: true,
  });
  check('a paused flow does not trigger', paused === null);
  await admin.from('flows').update({ status: 'live' }).eq('id', flowId);
  invalidateTriggerCache();

  // --- 9. an unmatched message leaves the turn to the AI ---------------------
  const aiConvo = await makeConversation(companyId, botId, 'tg:1004');
  const noMatch = await runFlowTurn({
    ...turnParams,
    conversationId: aiConvo,
    visitorId: 'tg:1004',
    text: 'do you sell blue shirts',
    isFirstMessage: true,
  });
  check('an unrelated message does not start a flow', noMatch === null);

  // --- 10. a channel-restricted flow only runs on its channel ---------------
  const waFlowId = await makeFlow(companyId, botId, 'WhatsApp only', MENU_GRAPH);
  await admin.from('flows').update({ channels: ['whatsapp'], priority: 50 }).eq('id', waFlowId);
  await makeTrigger(companyId, waFlowId, 'keyword', 'order');
  invalidateTriggerCache();

  const wrongChannelConvo = await makeConversation(companyId, botId, 'tg:1005');
  await runFlowTurn({
    ...turnParams,
    conversationId: wrongChannelConvo,
    visitorId: 'tg:1005',
    text: 'order please',
    isFirstMessage: true,
  });
  const { data: wrongChannelSession } = await admin
    .from('flow_sessions')
    .select('flow_id')
    .eq('conversation_id', wrongChannelConvo)
    .maybeSingle();
  check(
    'a WhatsApp-only flow does not run on Telegram',
    wrongChannelSession?.flow_id === flowId,
    wrongChannelSession?.flow_id,
  );

  // --- 11. a welcome trigger fires on the first message ---------------------
  const welcomeGraph = {
    nodes: [node('s', 'start'), node('w', 'message', { text: 'Welcome!' }), node('e', 'end')],
    edges: [edge('s', 'w'), edge('w', 'e')],
  };
  const welcomeFlowId = await makeFlow(companyId, botId, 'Welcome', welcomeGraph);
  await makeTrigger(companyId, welcomeFlowId, 'welcome', '');
  invalidateTriggerCache();

  const welcomeConvo = await makeConversation(companyId, botId, 'tg:1006');
  const welcome = await runFlowTurn({
    ...turnParams,
    conversationId: welcomeConvo,
    visitorId: 'tg:1006',
    text: 'hello there',
    isFirstMessage: true,
  });
  check('a welcome trigger fires on the first message', welcome?.blocks[0]?.text === 'Welcome!');

  const laterConvo = await makeConversation(companyId, botId, 'tg:1007');
  const later = await runFlowTurn({
    ...turnParams,
    conversationId: laterConvo,
    visitorId: 'tg:1007',
    text: 'hello there',
    isFirstMessage: false,
  });
  check('a welcome trigger does not fire mid-conversation', later === null);
} catch (err) {
  console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
  state.failed += 1;
} finally {
  // Cascades clear bots, conversations, flows, sessions and events.
  if (companyId) await admin.from('companies').delete().eq('id', companyId);
  if (otherCompanyId) await admin.from('companies').delete().eq('id', otherCompanyId);
}

console.log(`\n${state.failed === 0 ? '✅' : '❌'} flow runtime (database): ${state.passed} passed, ${state.failed} failed`);
process.exit(state.failed === 0 ? 0 : 1);
