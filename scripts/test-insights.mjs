// AI insights verification — pure logic, no database, no model call.
//
// The property that matters most here is that no number reaching the business
// owner came from a language model. So the tests assert both halves: the
// arithmetic pass computes the figures, and the model pass is stripped of
// anything it is not entitled to claim.
import { loadTs, makeChecker } from './lib/ts-load.mjs';

const { check, state } = makeChecker();

const modules = await loadTs(
  ['src/lib/ai/insights/evidence.ts', 'src/lib/ai/insights/rules.ts', 'src/lib/flows/nlu.ts'],
  {
    '@/lib/db/server': `export function createSupabaseServiceClient() { throw new Error('no database in this test'); }`,
    '@/lib/crypto': `export function encryptSecret(v){return v;} export function decryptSecret(v){return v;}`,
    '@/lib/logger': `export const logger = { info(){}, warn(){}, error(){}, debug(){} };`,
    '@/lib/channels/http': `export async function getJson(){return {ok:false,body:null};}`,
  },
);

const { buildEvidence, fingerprint, MIN_CONVERSATIONS_FOR_INSIGHTS } =
  modules['src/lib/ai/insights/evidence.ts'];
const { deterministicFindings, sanitiseModelFindings, dedupeFindings } =
  modules['src/lib/ai/insights/rules.ts'];
const { tokenize } = modules['src/lib/flows/nlu.ts'];

const NOW = new Date('2026-03-31T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

function convo(id, over = {}) {
  return { id, channel: 'web_chat', status: 'ai_active', started_at: daysAgo(5), ...over };
}

function evidenceFor(over = {}) {
  return buildEvidence(
    {
      periodDays: 30,
      now: NOW,
      conversations: [],
      messages: [],
      ratings: [],
      flowEvents: [],
      slaStates: [],
      flowNames: new Map(),
      unanswered: [],
      ...over,
    },
    tokenize,
  );
}

// --- 1. thin data is refused -------------------------------------------------
const thin = evidenceFor({ conversations: Array.from({ length: 5 }, (_, i) => convo(`c${i}`)) });
check('a handful of conversations is marked thin', thin.thin === true);
check(
  'the threshold is enforced, not approximated',
  evidenceFor({
    conversations: Array.from({ length: MIN_CONVERSATIONS_FOR_INSIGHTS }, (_, i) => convo(`c${i}`)),
  }).thin === false,
);
check('a thin period produces no findings worth showing', deterministicFindings(thin).length === 0);

// --- 2. period splitting -----------------------------------------------------
const split = evidenceFor({
  conversations: [
    ...Array.from({ length: 20 }, (_, i) => convo(`now${i}`, { started_at: daysAgo(5) })),
    ...Array.from({ length: 40 }, (_, i) => convo(`prev${i}`, { started_at: daysAgo(45) })),
  ],
});
check('current period counted correctly', split.totals.conversations === 20, split.totals);
check('previous period counted separately', split.totals.conversationsPrevious === 40);

const volume = deterministicFindings(split).find((f) => f.evidence.metric === 'volume');
check('a large drop in volume is reported', volume !== undefined);
check('the drop is stated as -50%', volume?.evidence.change === -50, volume?.evidence);
check('a volume change is only informational', volume?.severity === 'info');

// --- 3. escalation and containment ------------------------------------------
const escalated = evidenceFor({
  conversations: [
    ...Array.from({ length: 25 }, (_, i) => convo(`e${i}`, { status: 'needs_human' })),
    ...Array.from({ length: 15 }, (_, i) => convo(`a${i}`, { status: 'ai_active' })),
  ],
});
check('containment rate computed', escalated.totals.containmentRate === 38, escalated.totals.containmentRate);
const containment = deterministicFindings(escalated).find((f) => f.evidence.metric === 'containment');
check('low containment is flagged', containment !== undefined);
check('it points at business info, where the fix actually is', containment?.actionHref === '/company/business-data');

// --- 4. satisfaction ---------------------------------------------------------
const csat = evidenceFor({
  conversations: Array.from({ length: 40 }, (_, i) => convo(`c${i}`)),
  ratings: [
    ...Array.from({ length: 12 }, () => ({ rating: 3, channel: 'web_chat', created_at: daysAgo(5) })),
    ...Array.from({ length: 12 }, () => ({ rating: 5, channel: 'web_chat', created_at: daysAgo(45) })),
  ],
});
check('current CSAT averaged', csat.totals.csatAverage === 3);
check('previous CSAT averaged separately', csat.totals.csatPreviousAverage === 5);

const csatFindings = deterministicFindings(csat);
const drop = csatFindings.find((f) => f.fingerprint === fingerprint('answer_quality', 'csat-drop'));
check('a two-point fall is reported', drop !== undefined);
check('a fall of one point or more is critical', drop?.severity === 'critical', drop?.severity);
check('the finding carries its own evidence', drop?.evidence.before === 5 && drop?.evidence.after === 3);

// A small sample must not produce a finding.
const smallSample = evidenceFor({
  conversations: Array.from({ length: 40 }, (_, i) => convo(`c${i}`)),
  ratings: [
    { rating: 2, channel: 'web_chat', created_at: daysAgo(5) },
    { rating: 5, channel: 'web_chat', created_at: daysAgo(45) },
  ],
});
check(
  'two ratings are not enough to claim a trend',
  deterministicFindings(smallSample).every((f) => f.evidence.metric !== 'csat'),
);

// --- 5. reply-time breaches --------------------------------------------------
const sla = evidenceFor({
  conversations: Array.from({ length: 30 }, (_, i) => convo(`c${i}`)),
  slaStates: [
    ...Array.from({ length: 8 }, () => ({
      first_response_at: null,
      first_response_breached: true,
      resolution_breached: false,
    })),
    ...Array.from({ length: 12 }, () => ({
      first_response_at: daysAgo(3),
      first_response_breached: false,
      resolution_breached: false,
    })),
  ],
});
const breach = deterministicFindings(sla).find((f) => f.evidence.metric === 'sla_breach_rate');
check('a 40% breach rate is reported', breach?.evidence.value === 40, breach?.evidence);
check('40% is a warning, not yet critical', breach?.severity === 'warning');

// --- 6. per-channel ----------------------------------------------------------
const channels = evidenceFor({
  conversations: [
    ...Array.from({ length: 20 }, (_, i) => convo(`w${i}`, { channel: 'whatsapp' })),
    ...Array.from({ length: 20 }, (_, i) => convo(`b${i}`, { channel: 'web_chat' })),
  ],
  ratings: Array.from({ length: 10 }, () => ({ rating: 2, channel: 'whatsapp', created_at: daysAgo(4) })),
});
check('channels are sliced', channels.channels.length === 2);
const whatsapp = channels.channels.find((c) => c.channel === 'whatsapp');
check('per-channel CSAT is averaged', whatsapp?.csatAverage === 2 && whatsapp?.csatSample === 10);
const channelFinding = deterministicFindings(channels).find((f) => f.evidence.metric === 'csat_by_channel');
check('a weak channel is named', channelFinding?.evidence.channel === 'whatsapp');
check('the title uses the platform name, not the enum', channelFinding?.title.includes('WhatsApp'));

// --- 7. topics ---------------------------------------------------------------
const topics = evidenceFor({
  conversations: Array.from({ length: 20 }, (_, i) => convo(`c${i}`)),
  messages: [
    ...['c0', 'c1', 'c2', 'c3'].map((id) => ({
      conversation_id: id,
      sender_type: 'visitor',
      content_text: 'do you deliver to Karachi',
      created_at: daysAgo(3),
    })),
    // One customer repeating themselves must not create a topic.
    ...Array.from({ length: 9 }, () => ({
      conversation_id: 'c9',
      sender_type: 'visitor',
      content_text: 'refund refund refund',
      created_at: daysAgo(3),
    })),
    // The assistant's own words are never a customer topic.
    {
      conversation_id: 'c5',
      sender_type: 'ai',
      content_text: 'delivery delivery delivery karachi karachi karachi',
      created_at: daysAgo(3),
    },
  ],
});
const terms = topics.topics.map((t) => t.term);
check('a topic several customers raised is found', terms.includes('karachi'), terms);
check('it is counted per conversation, not per message', topics.topics.find((t) => t.term === 'karachi')?.conversations === 4);
check('one customer repeating a word is not a topic', !terms.includes('refund'), terms);
check('the assistant’s own messages are excluded', topics.topics.every((t) => t.conversations <= 4));

// --- 8. flow drop-off --------------------------------------------------------
const flows = evidenceFor({
  conversations: Array.from({ length: 20 }, (_, i) => convo(`c${i}`)),
  flowNames: new Map([['f1', 'Booking']]),
  flowEvents: [
    ...Array.from({ length: 10 }, (_, i) => ({
      flow_id: 'f1',
      node_id: 'ask_date',
      node_type: 'ask',
      event: 'entered',
      conversation_id: `c${i}`,
    })),
    ...Array.from({ length: 2 }, (_, i) => ({
      flow_id: 'f1',
      node_id: 'ask_date',
      node_type: 'ask',
      event: 'answered',
      conversation_id: `c${i}`,
    })),
    // A message block cannot be "abandoned" — it must not appear.
    ...Array.from({ length: 10 }, (_, i) => ({
      flow_id: 'f1',
      node_id: 'greeting',
      node_type: 'message',
      event: 'entered',
      conversation_id: `c${i}`,
    })),
  ],
});
check('one drop-off point found', flows.flowDropOff.length === 1, flows.flowDropOff);
check('the question block is the one reported', flows.flowDropOff[0]?.nodeId === 'ask_date');
check('the drop rate is 80%', flows.flowDropOff[0]?.dropRate === 80);
const flowFinding = deterministicFindings(flows).find((f) => f.evidence.metric === 'flow_drop_off');
check('it links to that flow', flowFinding?.actionHref === '/company/flows/f1');
check('the flow name is used, not its id', flowFinding?.title.includes('Booking'));

// --- 9. the model pass is not trusted with numbers ---------------------------
const supplied = ['do you deliver to Karachi', 'what are your prices'];
const modelFindings = sanitiseModelFindings(
  {
    findings: [
      {
        title: 'Delivery areas are missing',
        detail: 'Several people asked where you deliver.',
        recommendation: 'List your delivery areas.',
        category: 'knowledge_gap',
        severity: 'critical', // must be downgraded
        examples: ['do you deliver to Karachi', 'a question nobody asked'],
      },
      { title: '', detail: 'no title' },
      { title: 'No detail' },
      { title: 'Bad category', detail: 'x', category: 'nonsense' },
    ],
  },
  supplied,
);
check('empty findings are dropped', modelFindings.length === 2, modelFindings.length);
check('the model cannot mark anything critical', modelFindings.every((f) => f.severity !== 'critical'));
check('an unknown category falls back safely', modelFindings[1]?.category === 'knowledge_gap');
check(
  'invented examples are stripped',
  modelFindings[0]?.evidence.examples.length === 1 &&
    modelFindings[0]?.evidence.examples[0] === 'do you deliver to Karachi',
  modelFindings[0]?.evidence,
);
check('model findings are labelled as model-sourced', modelFindings[0]?.evidence.source === 'model');
check('a non-array response yields nothing', sanitiseModelFindings('not json', supplied).length === 0);
check('at most six model findings are accepted', sanitiseModelFindings(
  { findings: Array.from({ length: 20 }, (_, i) => ({ title: `t${i}`, detail: 'd' })) },
  supplied,
).length === 6);

// --- 10. deduplication -------------------------------------------------------
const deduped = dedupeFindings([
  { fingerprint: 'a', severity: 'info', category: 'other', title: 'x', detail: 'y', evidence: {} },
  { fingerprint: 'a', severity: 'critical', category: 'other', title: 'x', detail: 'y', evidence: {} },
  { fingerprint: 'b', severity: 'warning', category: 'other', title: 'z', detail: 'y', evidence: {} },
]);
check('duplicates collapse to one', deduped.length === 2);
check('the more serious copy survives', deduped[0]?.severity === 'critical');
check('the list is ordered most serious first', deduped[1]?.severity === 'warning');

// --- 11. fingerprints are stable ---------------------------------------------
check(
  'the same issue fingerprints identically',
  fingerprint('channel', 'csat-whatsapp') === fingerprint('channel', 'csat-whatsapp'),
);
check(
  'different issues do not collide',
  fingerprint('channel', 'csat-whatsapp') !== fingerprint('channel', 'csat-telegram'),
);

console.log(`\n${state.failed === 0 ? '✅' : '❌'} AI insights: ${state.passed} passed, ${state.failed} failed`);
process.exit(state.failed === 0 ? 0 : 1);
