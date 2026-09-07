// Reports aggregation verification — pure logic, no database and no network.
//
// `src/modules/company/reports-data.ts` does the fetching; every piece of
// arithmetic it performs lives in `reports-metrics.ts`, which imports nothing
// but the flow tokenizer. That split is what this script exercises: real
// TypeScript source, fixture rows, and the Supabase client stubbed to throw so
// a stray query would fail the run rather than pass silently.
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
`;

// `@/lib/flows/nlu` is aliased, so the loader cannot follow it the way it
// follows a relative import. It is emitted alongside as a second entry point
// and the alias is pointed at the emitted file — the REAL tokenizer and its
// real stopword list, not a copy, which is the whole point of the topic test.
const nluStub = `export * from './src__lib__flows__nlu.mjs';`;

const modules = await loadTs(['src/modules/company/reports-metrics.ts', 'src/lib/flows/nlu.ts'], {
  '@/lib/db/server': dbStub,
  '@/lib/crypto': cryptoStub,
  '@/lib/logger': loggerStub,
  '@/lib/channels/http': httpStub,
  '@/lib/flows/nlu': nluStub,
});

const m = modules['src/modules/company/reports-metrics.ts'];
const nlu = modules['src/lib/flows/nlu.ts'];
check('the real flow tokenizer is in use', typeof nlu.tokenize === 'function' && nlu.tokenize('where is my order').join(',') === 'order');

// --- 1. heatmap bucketing ---------------------------------------------------
// 2026-03-01 is a Sunday (day 0). The pair either side of midnight is the whole
// point: a naive hour-only bucket puts both on Sunday.
const heat = m.buildHourHeatmap([
  '2026-03-01T09:15:00.000Z',
  '2026-03-01T09:59:59.000Z',
  '2026-03-01T23:30:00.000Z',
  '2026-03-02T00:15:00.000Z', // Monday 00:00
  '2026-03-03T14:05:00.000Z', // Tuesday 14:00
]);

check('heatmap has 7 rows of 24', heat.grid.length === 7 && heat.grid.every((r) => r.length === 24));
check('two Sunday 09:00 conversations land in one cell', heat.grid[0][9] === 2, heat.grid[0][9]);
check('Sunday 23:30 stays on Sunday hour 23', heat.grid[0][23] === 1, heat.grid[0][23]);
check('Monday 00:15 crosses the day boundary to Monday hour 0', heat.grid[1][0] === 1, heat.grid[1][0]);
check('Tuesday 14:05 buckets to Tuesday hour 14', heat.grid[2][14] === 1, heat.grid[2][14]);
check('heatmap total counts every timestamp', heat.total === 5, heat.total);
check('heatmap peak is the busiest cell', heat.peak.day === 0 && heat.peak.hour === 9 && heat.peak.count === 2, heat.peak);
check('heatmap max is the peak count', heat.max === 2, heat.max);

// A positive offset pushes a late-evening event over midnight into the next day.
const shifted = m.buildHourHeatmap(['2026-03-01T23:30:00.000Z'], 60);
check('timezone offset moves 23:30 UTC to Monday 00:00', shifted.grid[1][0] === 1, shifted.grid[1]);

// Garbage in the column must not corrupt the grid or the total.
const dirty = m.buildHourHeatmap([null, undefined, '', 'not-a-date', '2026-03-01T09:00:00.000Z']);
check('unparseable timestamps are skipped, not bucketed', dirty.total === 1, dirty.total);
check('empty heatmap has a null peak and max 1', m.buildHourHeatmap([]).peak === null && m.buildHourHeatmap([]).max === 1);
check('heatmap cell label reads as a range', m.describeHeatmapCell(2, 14) === 'Tue 14:00–15:00', m.describeHeatmapCell(2, 14));
check('heatmap cell label wraps at midnight', m.describeHeatmapCell(0, 23) === 'Sun 23:00–00:00', m.describeHeatmapCell(0, 23));

// --- 2. median --------------------------------------------------------------
check('median of an odd count is the middle value', m.median([5, 1, 3]) === 3, m.median([5, 1, 3]));
check('median of an even count averages the two middles', m.median([1, 2, 3, 4]) === 2.5, m.median([1, 2, 3, 4]));
check('median of an even count with a wide tail', m.median([2, 4, 6, 600]) === 5, m.median([2, 4, 6, 600]));
check('median of one value is that value', m.median([7]) === 7);
check('median of two values is their mean', m.median([1, 4]) === 2.5, m.median([1, 4]));
check('median of nothing is null', m.median([]) === null);
check('median does not mutate its input', (() => { const v = [3, 1, 2]; m.median(v); return v[0] === 3; })());
check('median rounds to one decimal', m.median([1, 2, 2, 3.34]) === 2, m.median([1, 2, 2, 3.34]));
// The reason it is a median: one overnight reply must not move the typical case.
check('one outlier does not move the median', m.median([2, 3, 4, 5, 4000]) === 4, m.median([2, 3, 4, 5, 4000]));

// --- 3. funnel percentages with a zero denominator --------------------------
const funnel = m.buildFunnel([
  { key: 'conversations', label: 'Conversations', count: 200 },
  { key: 'leads', label: 'Leads', count: 50 },
  { key: 'qualified', label: 'Qualified', count: 20 },
  { key: 'converted', label: 'Converted', count: 5 },
]);
check('funnel first stage is 100% of itself', funnel[0].ofStart === 100 && funnel[0].ofPrevious === 100);
check('funnel ofStart is a share of the first stage', funnel[2].ofStart === 10, funnel[2].ofStart);
check('funnel ofPrevious is a share of the step above', funnel[2].ofPrevious === 40, funnel[2].ofPrevious);
check('funnel last stage percentages', funnel[3].ofStart === 3 && funnel[3].ofPrevious === 25, funnel[3]);

const emptyFunnel = m.buildFunnel([
  { key: 'conversations', label: 'Conversations', count: 0 },
  { key: 'leads', label: 'Leads', count: 0 },
  { key: 'converted', label: 'Converted', count: 0 },
]);
check('empty funnel is all zeroes, never NaN', emptyFunnel.every((s) => s.ofStart === 0 && s.ofPrevious === 0), emptyFunnel);
check('empty funnel percentages are finite', emptyFunnel.every((s) => Number.isFinite(s.ofStart)));

// A stage above can be empty while a later one is not (a lead imported without
// a conversation). That must be 0%, not Infinity.
const brokenFunnel = m.buildFunnel([
  { key: 'a', label: 'A', count: 10 },
  { key: 'b', label: 'B', count: 0 },
  { key: 'c', label: 'C', count: 3 },
]);
check('a stage below an empty stage does not divide by zero', brokenFunnel[2].ofPrevious === 0, brokenFunnel[2]);
check('percentage of a zero total is 0', m.percentage(5, 0) === 0);
check('percentage of a negative total is 0', m.percentage(5, -1) === 0);

// --- 4. containment rate ----------------------------------------------------
check('containment with no escalations is 100%', m.containmentRate(40, 0) === 100);
check('containment with every chat escalated is 0%', m.containmentRate(40, 40) === 0);
check('containment is the contained share', m.containmentRate(200, 50) === 75, m.containmentRate(200, 50));
check('containment rounds to a whole percent', m.containmentRate(3, 1) === 67, m.containmentRate(3, 1));
check('containment of an empty period is 0, not NaN', m.containmentRate(0, 0) === 0);
// Escalations can outnumber the window's conversations when a chat started
// earlier and escalated inside it; the rate must floor at 0, never go negative.
check('containment floors at 0 when escalations exceed the total', m.containmentRate(5, 9) === 0, m.containmentRate(5, 9));

// --- 5. topics ignoring stopwords -------------------------------------------
const topics = m.topTopics([
  'How do I get a refund for my order?',
  'I want a refund please',
  'Can you tell me about the refund policy',
  'What are your delivery times?',
  'delivery is late',
]);
const terms = topics.map((t) => t.term);
check('refund is the top topic', topics[0].term === 'refund' && topics[0].count === 3, topics[0]);
check('delivery is counted across messages', topics.find((t) => t.term === 'delivery').count === 2, terms);
for (const stop of ['how', 'the', 'what', 'you', 'for', 'my', 'can', 'are', 'want', 'please']) {
  check(`stopword "${stop}" is excluded from topics`, !terms.includes(stop), terms);
}
check('single-character tokens are excluded', !terms.includes('i'), terms);
check('topic share is a percentage of messages considered', topics[0].share === 60, topics[0].share);
// Counted once per message, so shouting the same word does not stuff the chart.
const repeated = m.topTopics(['refund refund refund refund', 'delivery', 'delivery']);
check('a term repeated in one message counts once', repeated.find((t) => t.term === 'refund').count === 1, repeated);
check('delivery outranks the repeated refund', repeated[0].term === 'delivery', repeated);
check('topics of nothing is an empty list', m.topTopics([]).length === 0);
check('topics ignores null and empty texts', m.topTopics([null, '', undefined]).length === 0);
check('topic limit is respected', m.topTopics(['alpha beta gamma delta epsilon zeta'], 3).length === 3);

// --- 6. CSV escaping --------------------------------------------------------
check('plain value is quoted', m.csvField('hello') === '"hello"', m.csvField('hello'));
check(
  'a value containing a comma survives as one field',
  m.csvField('Smith, John') === '"Smith, John"',
  m.csvField('Smith, John'),
);
check(
  'an internal quote is doubled',
  m.csvField('say "hi"') === '"say ""hi"""',
  m.csvField('say "hi"'),
);
check(
  'a value with both a comma and a quote',
  m.csvField('Yes, "urgent" please') === '"Yes, ""urgent"" please"',
  m.csvField('Yes, "urgent" please'),
);
check('null becomes an empty field', m.csvField(null) === '""');
check('undefined becomes an empty field', m.csvField(undefined) === '""');
check('zero is not treated as empty', m.csvField(0) === '"0"', m.csvField(0));
check('a newline stays inside the quotes', m.csvField('line1\nline2') === '"line1\nline2"');

const csv = m.toCsv(['name', 'note'], [['Ada', 'Yes, "urgent" please'], ['Bob', null]]);
const lines = csv.split('\r\n');
check('csv uses CRLF line endings', lines.length === 3, lines.length);
check('csv header is quoted', lines[0] === '"name","note"', lines[0]);
check('csv row escapes comma and quote together', lines[1] === '"Ada","Yes, ""urgent"" please"', lines[1]);
check('csv null cell is empty', lines[2] === '"Bob",""', lines[2]);
// The whole point of quoting: the tricky row must still be two columns.
check('the escaped row still parses as two fields', (lines[1].match(/","/g) || []).length === 1, lines[1]);

// --- 7. first contact resolution --------------------------------------------
const convos = [
  { id: 'c1', visitorId: 'v1', startedAt: '2026-03-01T10:00:00.000Z', status: 'closed' }, // resolved
  { id: 'c2', visitorId: 'v2', startedAt: '2026-03-01T10:00:00.000Z', status: 'closed' }, // agent replied
  { id: 'c3', visitorId: 'v3', startedAt: '2026-03-01T10:00:00.000Z', status: 'closed' }, // came back
  { id: 'c4', visitorId: 'v3', startedAt: '2026-03-01T12:00:00.000Z', status: 'closed' }, // the return visit
  { id: 'c5', visitorId: 'v5', startedAt: '2026-03-01T10:00:00.000Z', status: 'ai_active' }, // still open
];
const fcr = m.firstContactResolution(convos, new Set(['c2']));
check('fcr denominator is closed conversations only', fcr.closed === 4, fcr.closed);
check('fcr excludes human-touched and repeat visits', fcr.resolvedFirstContact === 2, fcr.resolvedFirstContact);
check('fcr rate is a whole percent', fcr.rate === 50, fcr.rate);
check('fcr with nothing closed reports null, not zero', m.firstContactResolution([], new Set()).rate === null);
// A return visit a week later is a new question, not a failed resolution.
const late = m.firstContactResolution(
  [
    { id: 'a', visitorId: 'v', startedAt: '2026-03-01T10:00:00.000Z', status: 'closed' },
    { id: 'b', visitorId: 'v', startedAt: '2026-03-09T10:00:00.000Z', status: 'closed' },
  ],
  new Set(),
);
check('a return visit outside 24h does not break first contact', late.resolvedFirstContact === 2, late);

// --- 8. new vs returning ----------------------------------------------------
const split = m.splitVisitors(['v1', 'v1', 'v2', 'v3', 'v3', 'v3', null, null]);
check('returning visitors are counted once each', split.returningVisitors === 2, split);
check('new visitors had exactly one conversation', split.newVisitors === 1, split);
check('anonymous conversations are held separately', split.anonymous === 2, split);
check('returning rate excludes anonymous chats', split.returningRate === 67, split.returningRate);
check('splitting nothing yields zeroes', m.splitVisitors([]).returningRate === 0);

// --- 9. question grouping ---------------------------------------------------
const grouped = m.groupQuestions([
  'Do you ship to Canada?',
  'do you ship to canada',
  '  Do you ship to Canada?  ',
  'What is your return policy?',
  null,
  '   ',
]);
check('near-identical questions collapse into one row', grouped.length === 2, grouped);
check('the collapsed group keeps its count', grouped[0].count === 3, grouped[0]);
check('the first spelling seen is kept for display', grouped[0].question === 'Do you ship to Canada?', grouped[0]);
check('blank and null questions are dropped', grouped.every((g) => g.question.trim().length > 0));

// --- 10. average ------------------------------------------------------------
check('average rounds to one decimal', m.average([1, 2, 2]) === 1.7, m.average([1, 2, 2]));
check('average of nothing is null', m.average([]) === null);

console.log(`\n${state.failed === 0 ? '✅' : '❌'} reports: ${state.passed} passed, ${state.failed} failed`);
process.exit(state.failed === 0 ? 0 : 1);
