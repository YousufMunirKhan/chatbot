// Flow engine verification — pure logic, no database and no network.
//
// Covers the runtime that every channel now runs before the AI: block
// rendering, parking on a question, resuming with the customer's answer,
// validation + retries, branching, the HTTP block, loop protection, and the
// trigger/intent matching rules.
import { loadTs, makeChecker } from './lib/ts-load.mjs';

const { check, state } = makeChecker();

const dbStub = `
export function createSupabaseServiceClient() {
  throw new Error('the database must not be touched by a pure-logic test');
}
`;
const cryptoStub = `
export function encryptSecret(v) { return v; }
export function decryptSecret(v) { return v; }
`;
const loggerStub = `
export const logger = { info() {}, warn() {}, error() {}, debug() {} };
`;
const httpStub = `
export async function getJson() { return { ok: false, status: 0, body: null }; }
export async function postJson() { return { ok: false, status: 0, body: null }; }
export async function request() { return { ok: false, status: 0, body: null }; }
export function safeUrl(u) { return u; }
`;

const modules = await loadTs(
  ['src/lib/flows/engine.ts', 'src/lib/flows/types.ts', 'src/lib/flows/triggers.ts', 'src/lib/flows/nlu.ts'],
  {
    '@/lib/db/server': dbStub,
    '@/lib/crypto': cryptoStub,
    '@/lib/logger': loggerStub,
    '@/lib/channels/http': httpStub,
  },
);

const engine = modules['src/lib/flows/engine.ts'];
const types = modules['src/lib/flows/types.ts'];
const triggers = modules['src/lib/flows/triggers.ts'];
const nlu = modules['src/lib/flows/nlu.ts'];

const node = (id, type, data = {}) => ({ id, type, position: { x: 0, y: 0 }, data });
const edge = (source, target, sourceHandle) => ({ id: `${source}->${target}`, source, target, sourceHandle });

// --- 1. interpolation -------------------------------------------------------
check(
  'interpolate fills known variables',
  engine.interpolate('Hi {{name}}, order {{order_id}}', { name: 'Sara', order_id: 42 }) === 'Hi Sara, order 42',
);
check('interpolate blanks unknown variables', engine.interpolate('Hi {{missing}}!', {}) === 'Hi !');

// --- 2. answer validation ---------------------------------------------------
check('email accepted', engine.validateAnswer('  A@B.COM ', 'email').ok === true);
check('email normalised to lowercase', engine.validateAnswer('A@B.com', 'email').normalised === 'a@b.com');
check('bad email rejected', engine.validateAnswer('not-an-email', 'email').ok === false);
check('phone accepted and stripped', engine.validateAnswer('+92 (300) 123-4567', 'phone').normalised === '+923001234567');
check('short phone rejected', engine.validateAnswer('123', 'phone').ok === false);
check('number parsed', engine.validateAnswer('12 units', 'number').normalised === '12');
check('date normalised', engine.validateAnswer('2026-03-04', 'date').normalised === '2026-03-04');
check('url rejected when not http', engine.validateAnswer('ftp://x.com', 'url').ok === false);
check('empty text rejected', engine.validateAnswer('   ', 'text').ok === false);

// --- 3. choice matching -----------------------------------------------------
const choices = [
  { id: 'c1', label: 'Track my order', value: 'track' },
  { id: 'c2', label: 'Talk to a human', value: 'human' },
];
check('choice matches by payload', engine.matchChoice(choices, 'track')?.id === 'c1');
check('choice matches by label', engine.matchChoice(choices, 'talk to a human')?.id === 'c2');
check('choice matches by position', engine.matchChoice(choices, '2')?.id === 'c2');
check('choice matches by id', engine.matchChoice(choices, 'c1')?.id === 'c1');
check('unknown answer does not match', engine.matchChoice(choices, 'something else') === null);

// --- 4. a linear flow renders every content block ---------------------------
const linear = {
  nodes: [
    node('s', 'start'),
    node('m', 'message', { text: 'Hello {{contact_name}}' }),
    node('img', 'image', { url: 'https://cdn.test/a.png', caption: 'Look' }),
    node('g', 'gallery', {
      items: [{ title: 'Shirt', subtitle: 'PKR 2000', imageUrl: 'https://cdn.test/s.png', buttons: [{ id: 'b', label: 'Buy', value: 'buy_shirt' }] }],
    }),
    node('e', 'end', { text: 'Bye' }),
  ],
  edges: [edge('s', 'm'), edge('m', 'img'), edge('img', 'g'), edge('g', 'e')],
};
const linearRun = await engine.runFlow({ graph: linear, state: { contact_name: 'Ali' } });
check('linear flow completes', linearRun.completed === true && linearRun.awaitingNodeId === null);
check('linear flow emits 4 blocks', linearRun.blocks.length === 4, linearRun.blocks.map((b) => b.type));
check('message interpolated', linearRun.blocks[0].text === 'Hello Ali');
check('gallery mapped with buttons', linearRun.blocks[2].items[0].buttons[0].value === 'buy_shirt');

// --- 5. a buttons node parks, then the answer routes -------------------------
const menu = {
  nodes: [
    node('s', 'start'),
    node('menu', 'buttons', {
      text: 'What do you need?',
      variable: 'topic',
      choices: [
        { id: 'order', label: 'Order status', value: 'order' },
        { id: 'human', label: 'Talk to a human', value: 'human' },
      ],
    }),
    node('orderMsg', 'message', { text: 'Your order is on the way.' }),
    node('agent', 'handoff', { text: 'Connecting you to an agent.' }),
    node('fallbackMsg', 'message', { text: 'Let me look that up.' }),
  ],
  edges: [
    edge('s', 'menu'),
    edge('menu', 'orderMsg', 'order'),
    edge('menu', 'agent', 'human'),
    edge('menu', 'fallbackMsg', 'fallback'),
  ],
};
const menuRun = await engine.runFlow({ graph: menu });
check('buttons node parks the flow', menuRun.awaitingNodeId === 'menu' && menuRun.completed === false);
check('buttons block rendered', menuRun.blocks[0].type === 'buttons' && menuRun.blocks[0].buttons.length === 2);

const menuOrder = await engine.runFlow({ graph: menu, startNodeId: 'menu', input: 'order', state: menuRun.state });
check('answer follows the matching branch', menuOrder.blocks[0].text === 'Your order is on the way.');
check('choice stored in its variable', menuOrder.state.topic === 'order');

const menuHuman = await engine.runFlow({ graph: menu, startNodeId: 'menu', input: '2', state: menuRun.state });
check('positional answer reaches the handoff branch', menuHuman.handoffToHuman === true);
check('handoff records an effect', menuHuman.effects.some((e) => e.type === 'handoff'));

const menuUnknown = await engine.runFlow({ graph: menu, startNodeId: 'menu', input: 'where is my refund', state: menuRun.state });
check('unmatched answer takes the fallback wire', menuUnknown.blocks[0].text === 'Let me look that up.');

// A menu with no fallback wired should hand the turn to the AI instead of
// repeating itself at the customer.
const noFallback = { nodes: menu.nodes, edges: menu.edges.filter((e) => e.sourceHandle !== 'fallback') };
const noFallbackRun = await engine.runFlow({ graph: noFallback, startNodeId: 'menu', input: 'refund please' });
check('no fallback hands the turn to the AI', noFallbackRun.handoffToAi === true);
check('AI handoff keeps the node parked', noFallbackRun.awaitingNodeId === 'menu');

// --- 6. ask + validation + retry --------------------------------------------
const askGraph = {
  nodes: [
    node('s', 'start'),
    node('ask', 'ask', { text: 'What is your email?', variable: 'email', validation: 'email', maxRetries: 1, retryText: 'That email looks wrong.' }),
    node('done', 'message', { text: 'Thanks {{email}}' }),
  ],
  edges: [edge('s', 'ask'), edge('ask', 'done')],
};
const askRun = await engine.runFlow({ graph: askGraph });
check('ask parks the flow', askRun.awaitingNodeId === 'ask');

const askBad = await engine.runFlow({ graph: askGraph, startNodeId: 'ask', input: 'nope', state: askRun.state });
check('invalid answer re-prompts', askBad.blocks[0].text === 'That email looks wrong.' && askBad.awaitingNodeId === 'ask');

const askBadAgain = await engine.runFlow({ graph: askGraph, startNodeId: 'ask', input: 'still-nope', state: askBad.state });
check('retries are capped, then the flow moves on', askBadAgain.awaitingNodeId === null);

const askGood = await engine.runFlow({ graph: askGraph, startNodeId: 'ask', input: 'Sara@Example.com', state: askRun.state });
check('valid answer stored normalised', askGood.state.email === 'sara@example.com');
check('flow continues after a valid answer', askGood.blocks[0].text === 'Thanks sara@example.com');

// --- 7. conditions ----------------------------------------------------------
const condGraph = {
  nodes: [
    node('s', 'start'),
    node('c', 'condition', { conditions: [{ variable: 'total', operator: 'greater_than', value: '1000' }] }),
    node('vip', 'message', { text: 'VIP' }),
    node('std', 'message', { text: 'Standard' }),
  ],
  edges: [edge('s', 'c'), edge('c', 'vip', 'true'), edge('c', 'std', 'false')],
};
check(
  'condition true branch',
  (await engine.runFlow({ graph: condGraph, state: { total: 5000 } })).blocks[0].text === 'VIP',
);
check(
  'condition false branch',
  (await engine.runFlow({ graph: condGraph, state: { total: 10 } })).blocks[0].text === 'Standard',
);

const multiCond = {
  nodes: [
    node('c', 'condition', {
      match: 'any',
      conditions: [
        { variable: 'city', operator: 'equals', value: 'Karachi' },
        { variable: 'city', operator: 'equals', value: 'Lahore' },
      ],
    }),
    node('yes', 'message', { text: 'covered' }),
    node('no', 'message', { text: 'not covered' }),
  ],
  edges: [edge('c', 'yes', 'true'), edge('c', 'no', 'false')],
};
check(
  'match=any passes when one clause matches',
  (await engine.runFlow({ graph: multiCond, state: { city: 'Lahore' } })).blocks[0].text === 'covered',
);

// --- 8. actions record effects ----------------------------------------------
const actionGraph = {
  nodes: [
    node('s', 'start'),
    node('t', 'tag', { tags: ['vip', 'newsletter'] }),
    node('sub', 'subscribe', { optIn: true }),
    node('lead', 'save_lead', { leadFields: { name: '{{contact_name}}', email: '{{email}}' } }),
    node('e', 'end'),
  ],
  edges: [edge('s', 't'), edge('t', 'sub'), edge('sub', 'lead'), edge('lead', 'e')],
};
const actionRun = await engine.runFlow({ graph: actionGraph, state: { contact_name: 'Ali', email: 'ali@x.com' } });
check('tag effect recorded', actionRun.effects.some((e) => e.type === 'tag' && e.tags.includes('vip')));
check('opt-in effect recorded', actionRun.effects.some((e) => e.type === 'subscribe' && e.optIn === true));
const leadEffect = actionRun.effects.find((e) => e.type === 'save_lead');
check('lead fields interpolated', leadEffect?.fields.name === 'Ali' && leadEffect?.fields.email === 'ali@x.com');

// --- 9. HTTP block ----------------------------------------------------------
const httpGraph = {
  nodes: [
    node('s', 'start'),
    node('h', 'http', {
      method: 'POST',
      url: 'https://api.test/orders/{{order_id}}',
      body: '{"id":"{{order_id}}"}',
      responseMap: { status_text: 'data.status', eta: 'data.eta' },
    }),
    node('ok', 'message', { text: 'Status: {{status_text}} ({{eta}})' }),
    node('bad', 'message', { text: 'Could not reach the store.' }),
  ],
  edges: [edge('s', 'h'), edge('h', 'ok', 'true'), edge('h', 'bad', 'false')],
};

let capturedUrl = null;
let capturedBody = null;
const okFetch = async (url, init) => {
  capturedUrl = url;
  capturedBody = init.body;
  return { ok: true, status: 200, text: async () => JSON.stringify({ data: { status: 'shipped', eta: 'Tuesday' } }) };
};
const httpOk = await engine.runFlow({
  graph: httpGraph,
  state: { order_id: 'A-100' },
  deps: { httpFetch: okFetch },
});
check('http url interpolated', capturedUrl === 'https://api.test/orders/A-100');
check('http body interpolated', capturedBody === '{"id":"A-100"}');
check('response mapped into variables', httpOk.state.status_text === 'shipped' && httpOk.state.eta === 'Tuesday');
check('success takes the true branch', httpOk.blocks[0].text === 'Status: shipped (Tuesday)');

const failFetch = async () => ({ ok: false, status: 500, text: async () => 'boom' });
const httpFail = await engine.runFlow({ graph: httpGraph, state: { order_id: 'A-100' }, deps: { httpFetch: failFetch } });
check('failure takes the false branch', httpFail.blocks[0].text === 'Could not reach the store.');

const throwFetch = async () => {
  throw new Error('network down');
};
const httpThrow = await engine.runFlow({ graph: httpGraph, state: {}, deps: { httpFetch: throwFetch } });
check('a thrown request does not crash the flow', httpThrow.blocks[0].text === 'Could not reach the store.');

// --- 10. loop protection ----------------------------------------------------
const loopGraph = {
  nodes: [node('a', 'message', { text: 'A' }), node('b', 'message', { text: 'B' })],
  edges: [edge('a', 'b'), edge('b', 'a')],
};
const loopRun = await engine.runFlow({ graph: loopGraph });
check('a wiring loop terminates', loopRun.completed === true);
check('a wiring loop is reported as an error', loopRun.effects.some((e) => e.type === 'node' && e.event === 'error'));

// --- 11. entry point resolution ---------------------------------------------
check('explicit start node found', engine.findStartNode(linear).id === 's');
check(
  'entry point inferred when there is no start block',
  engine.findStartNode({ nodes: [node('x', 'message'), node('y', 'message')], edges: [edge('x', 'y')] }).id === 'x',
);

// --- 12. graph parsing is defensive -----------------------------------------
check('parseGraph tolerates rubbish', types.parseGraph(null).nodes.length === 0);
check(
  'parseGraph drops malformed nodes and edges',
  types.parseGraph({ nodes: [{ id: 'ok' }, { nope: 1 }], edges: [{ source: 'a', target: 'b' }, { source: 'a' }] })
    .nodes.length === 1,
);

// --- 13. trigger matching rules ---------------------------------------------
check('contains matches a whole word', triggers.textMatches('I want a refund please', 'refund', 'contains'));
check('contains does not match inside a word', triggers.textMatches('this', 'hi', 'contains') === false);
check('exact requires the whole message', triggers.textMatches('hi', 'hi', 'exact') && !triggers.textMatches('hi there', 'hi', 'exact'));
check('starts_with anchors at the front', triggers.textMatches('order status please', 'order', 'starts_with'));
check('regex mode works', triggers.textMatches('ORD-2291', '^ord-\\d+$', 'regex'));
check('an invalid regex fails closed', triggers.textMatches('anything', '([', 'regex') === false);
check('an empty pattern never matches', triggers.textMatches('anything', '', 'contains') === false);

// --- 14. built-in intent classifier -----------------------------------------
const intents = [
  { id: '1', name: 'order_status', examples: ['where is my order', 'track my parcel', 'order status'] },
  { id: '2', name: 'refund', examples: ['I want a refund', 'money back please', 'return this item'] },
];
check(
  'classifier finds the right intent',
  nlu.classifyBuiltin('can you track my parcel', intents)?.name === 'order_status',
);
check('classifier finds the second intent', nlu.classifyBuiltin('I want my money back', intents)?.name === 'refund');
check('unrelated text matches nothing', nlu.classifyBuiltin('the weather is lovely today', intents) === null);
check('empty text matches nothing', nlu.classifyBuiltin('   ', intents) === null);
check('stopwords are dropped', nlu.tokenize('where is my order').join(',') === 'order');

console.log(`\n${state.failed === 0 ? '✅' : '❌'} flow engine: ${state.passed} passed, ${state.failed} failed`);
process.exit(state.failed === 0 ? 0 : 1);
