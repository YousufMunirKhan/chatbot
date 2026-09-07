// SLA engine verification — pure logic, no database and no network.
//
// The two things that make an SLA wrong in practice are business-hours
// arithmetic (a target that silently runs through a closed weekend) and policy
// selection (a specific rule losing to the catch-all because of row order).
// Both are covered exhaustively here.
import { loadTs, makeChecker } from './lib/ts-load.mjs';

const { check, state } = makeChecker();

const dbStub = `
export function createSupabaseServiceClient() {
  throw new Error('the database must not be touched by a pure-logic test');
}
`;
const loggerStub = `export const logger = { info() {}, warn() {}, error() {}, debug() {} };`;
const notifyStub = `export async function notify() {}`;

const modules = await loadTs(
  ['src/lib/sla/schedule.ts', 'src/lib/sla/index.ts', 'src/lib/business-hours.ts'],
  {
    '@/lib/db/server': dbStub,
    '@/lib/logger': loggerStub,
    '@/lib/notify': notifyStub,
    '@/lib/sla/schedule': `export * from './src__lib__sla__schedule.mjs';`,
  },
);

const schedule = modules['src/lib/sla/schedule.ts'];
const sla = modules['src/lib/sla/index.ts'];
const hours = modules['src/lib/business-hours.ts'];

// Mon–Fri 09:00–17:00, closed at the weekend.
const weekdays = schedule.buildSchedule(
  [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, isClosed: false, openTime: '09:00', closeTime: '17:00' })),
);
const at = (iso) => new Date(`${iso}Z`);
const iso = (d) => d.toISOString().slice(0, 16);

// --- 1. schedule parsing ----------------------------------------------------
check('five open days parsed', weekdays.size === 5);
check('closed days are excluded', !weekdays.has(0) && !weekdays.has(6));
check(
  'a day marked closed is dropped even with times',
  schedule.buildSchedule([{ dayOfWeek: 1, isClosed: true, openTime: '09:00', closeTime: '17:00' }]).size === 0,
);
check(
  'a day whose close is before its open is dropped',
  schedule.buildSchedule([{ dayOfWeek: 1, isClosed: false, openTime: '17:00', closeTime: '09:00' }]).size === 0,
);
check(
  'seconds in the stored time are tolerated',
  schedule.buildSchedule([{ dayOfWeek: 1, isClosed: false, openTime: '09:00:00', closeTime: '17:30:00' }]).size === 1,
);

// --- 2. adding business minutes --------------------------------------------
// Wednesday 2026-03-04 10:00 + 30 min, inside opening hours.
check(
  '30 minutes inside the working day',
  iso(schedule.addBusinessMinutes(at('2026-03-04T10:00:00'), 30, weekdays)) === '2026-03-04T10:30',
);
// 16:45 + 30 min must spill into the next morning, not to 17:15.
check(
  'a target spilling past closing resumes the next morning',
  iso(schedule.addBusinessMinutes(at('2026-03-04T16:45:00'), 30, weekdays)) === '2026-03-05T09:15',
);
// Friday evening + 60 min must land on Monday, skipping the weekend.
check(
  'the weekend is skipped',
  iso(schedule.addBusinessMinutes(at('2026-03-06T16:30:00'), 60, weekdays)) === '2026-03-09T09:30',
);
// Arriving before opening: the clock starts at 09:00, not at 07:00.
check(
  'a message before opening starts the clock at opening',
  iso(schedule.addBusinessMinutes(at('2026-03-04T07:00:00'), 15, weekdays)) === '2026-03-04T09:15',
);
// Arriving on a closed day.
check(
  'a Sunday message is due Monday morning',
  iso(schedule.addBusinessMinutes(at('2026-03-08T12:00:00'), 20, weekdays)) === '2026-03-09T09:20',
);
// A target longer than a single working day.
check(
  'a 10-hour target spans two working days',
  iso(schedule.addBusinessMinutes(at('2026-03-04T10:00:00'), 600, weekdays)) === '2026-03-05T12:00',
);
// No schedule configured → plain elapsed time, so an unconfigured company still
// gets a working SLA.
check(
  'an empty schedule falls back to elapsed time',
  iso(schedule.addBusinessMinutes(at('2026-03-07T23:30:00'), 60, new Map())) === '2026-03-08T00:30',
);
check(
  'a zero target returns the start instant',
  iso(schedule.addBusinessMinutes(at('2026-03-04T10:00:00'), 0, weekdays)) === '2026-03-04T10:00',
);
// A schedule where every day is closed must still produce a deadline.
check(
  'an all-closed schedule still yields a deadline',
  schedule.addBusinessMinutes(
    at('2026-03-04T10:00:00'),
    30,
    schedule.buildSchedule([{ dayOfWeek: 1, isClosed: true, openTime: null, closeTime: null }]),
  ) instanceof Date,
);

// --- 3. measuring elapsed business minutes ----------------------------------
check(
  'elapsed minutes inside one day',
  schedule.businessMinutesBetween(at('2026-03-04T10:00:00'), at('2026-03-04T10:45:00'), weekdays) === 45,
);
check(
  'time outside opening hours is not counted',
  schedule.businessMinutesBetween(at('2026-03-04T16:30:00'), at('2026-03-05T09:30:00'), weekdays) === 60,
);
check(
  'a weekend contributes nothing',
  schedule.businessMinutesBetween(at('2026-03-06T16:00:00'), at('2026-03-09T10:00:00'), weekdays) === 120,
);
check(
  'an end before the start is zero',
  schedule.businessMinutesBetween(at('2026-03-04T12:00:00'), at('2026-03-04T11:00:00'), weekdays) === 0,
);
check(
  'without a schedule every minute counts',
  schedule.businessMinutesBetween(at('2026-03-07T10:00:00'), at('2026-03-07T11:30:00'), new Map()) === 90,
);

// --- 4. inside/outside opening hours ----------------------------------------
check('10:00 on a Wednesday is open', schedule.isWithinBusinessHours(at('2026-03-04T10:00:00'), weekdays));
check('18:00 on a Wednesday is closed', !schedule.isWithinBusinessHours(at('2026-03-04T18:00:00'), weekdays));
check('Sunday is closed', !schedule.isWithinBusinessHours(at('2026-03-08T12:00:00'), weekdays));
check('closing time itself is closed', !schedule.isWithinBusinessHours(at('2026-03-04T17:00:00'), weekdays));
check('an empty schedule is always open', schedule.isWithinBusinessHours(at('2026-03-08T03:00:00'), new Map()));

// --- 6. timezones -----------------------------------------------------------
// Opening hours are wall-clock strings with no zone, so an instant has to be
// moved into the shop's frame before the arithmetic. Without this every
// business-hours target was wrong by the company's UTC offset.
check(
  'a zone ahead of UTC reports a positive offset',
  schedule.zoneOffsetMinutes(at('2026-03-04T12:00:00'), 'Asia/Karachi') === 300,
  schedule.zoneOffsetMinutes(at('2026-03-04T12:00:00'), 'Asia/Karachi'),
);
check(
  'a zone behind UTC reports a negative offset',
  schedule.zoneOffsetMinutes(at('2026-03-04T12:00:00'), 'America/New_York') === -300,
);
check('UTC itself is zero', schedule.zoneOffsetMinutes(at('2026-03-04T12:00:00'), 'UTC') === 0);
check(
  'daylight saving is followed, not assumed',
  schedule.zoneOffsetMinutes(at('2026-07-04T12:00:00'), 'America/New_York') === -240,
);
check(
  'an unknown zone falls back to UTC rather than throwing',
  schedule.zoneOffsetMinutes(at('2026-03-04T12:00:00'), 'Not/AZone') === 0,
);

// 07:00 UTC is midday in Karachi, so a 30-minute target is due at 12:30 local.
const karachiLocal = schedule.toZonedTime(at('2026-03-04T07:00:00'), 'Asia/Karachi');
check('an instant maps to the right wall-clock time', iso(karachiLocal) === '2026-03-04T12:00');
const karachiDue = schedule.fromZonedTime(
  schedule.addBusinessMinutes(karachiLocal, 30, weekdays),
  'Asia/Karachi',
);
check('the deadline converts back to the right instant', iso(karachiDue) === '2026-03-04T07:30', iso(karachiDue));

// 05:00 UTC is 10:00 in Karachi - inside opening hours. Treated as UTC it would
// be 05:00, before opening, and the deadline would jump to 09:00 UTC.
const insideHours = schedule.toZonedTime(at('2026-03-04T05:00:00'), 'Asia/Karachi');
const insideDue = schedule.fromZonedTime(schedule.addBusinessMinutes(insideHours, 15, weekdays), 'Asia/Karachi');
check(
  'a message inside local opening hours is not pushed to the next morning',
  iso(insideDue) === '2026-03-04T05:15',
  iso(insideDue),
);

// 16:00 UTC is 21:00 in Karachi - after closing. The target belongs to the next
// working morning: 09:00 local is 04:00 UTC.
const afterClose = schedule.toZonedTime(at('2026-03-04T16:00:00'), 'Asia/Karachi');
const afterCloseDue = schedule.fromZonedTime(schedule.addBusinessMinutes(afterClose, 20, weekdays), 'Asia/Karachi');
check(
  'a message after local closing waits for the next morning',
  iso(afterCloseDue) === '2026-03-05T04:20',
  iso(afterCloseDue),
);

check(
  'a round trip through the zone returns the original instant',
  schedule.fromZonedTime(schedule.toZonedTime(at('2026-03-04T07:00:00'), 'Asia/Karachi'), 'Asia/Karachi').getTime() ===
    at('2026-03-04T07:00:00').getTime(),
);
check(
  'no timezone configured leaves the instant untouched',
  schedule.toZonedTime(at('2026-03-04T07:00:00'), null).getTime() === at('2026-03-04T07:00:00').getTime(),
);

// --- 8. opening-hours gating -------------------------------------------------
// "Only while you are open" on a chat button was a saved setting that nothing
// ever read, so choosing it changed nothing the customer saw.
check('an unrestricted item always shows', hours.matchesBusinessHours('any', true));
check('an unrestricted item shows when closed too', hours.matchesBusinessHours('any', false));
check('a missing mode is treated as unrestricted', hours.matchesBusinessHours(undefined, false));
check('during_hours shows while open', hours.matchesBusinessHours('during_hours', true));
check('during_hours hides while closed', hours.matchesBusinessHours('during_hours', false) === false);
check('after_hours hides while open', hours.matchesBusinessHours('after_hours', true) === false);
check('after_hours shows while closed', hours.matchesBusinessHours('after_hours', false));
// Unknown hours must never hide a customer's only route to help.
check('unknown hours show a during_hours item', hours.matchesBusinessHours('during_hours', null));
check('unknown hours show an after_hours item', hours.matchesBusinessHours('after_hours', null));

// --- 7. policy selection ----------------------------------------------------
const policy = (over) => ({
  id: over.id,
  name: over.id,
  appliesPriority: null,
  appliesChannel: null,
  appliesGroupId: null,
  firstResponseMinutes: 15,
  resolutionMinutes: null,
  businessHoursOnly: false,
  escalateBeforeMinutes: null,
  escalateToUserId: null,
  priority: 0,
  ...over,
});

const catchAll = policy({ id: 'catch-all' });
const urgentAny = policy({ id: 'urgent', appliesPriority: 'urgent', firstResponseMinutes: 5 });
const whatsappUrgent = policy({
  id: 'urgent-whatsapp',
  appliesPriority: 'urgent',
  appliesChannel: 'whatsapp',
  firstResponseMinutes: 2,
});
const emailOnly = policy({ id: 'email', appliesChannel: 'email', firstResponseMinutes: 240 });

// Deliberately listed catch-all first: order must not decide the winner.
const all = [catchAll, urgentAny, whatsappUrgent, emailOnly];

check(
  'the most specific policy wins',
  sla.selectPolicy(all, { priority: 'urgent', channel: 'whatsapp' })?.id === 'urgent-whatsapp',
);
check(
  'a partly matching specific policy still beats the catch-all',
  sla.selectPolicy(all, { priority: 'urgent', channel: 'telegram' })?.id === 'urgent',
);
check('a channel-only policy matches', sla.selectPolicy(all, { channel: 'email' })?.id === 'email');
check(
  'the catch-all covers everything else',
  sla.selectPolicy(all, { priority: 'normal', channel: 'web_chat' })?.id === 'catch-all',
);
check(
  'a missing priority is treated as normal',
  sla.selectPolicy([urgentAny, catchAll], { channel: 'web_chat' })?.id === 'catch-all',
);
check('no policies means no SLA', sla.selectPolicy([], { priority: 'urgent' }) === null);
check(
  'nothing matches when every policy is filtered out',
  sla.selectPolicy([emailOnly], { channel: 'whatsapp' }) === null,
);
check(
  'the explicit order column breaks a specificity tie',
  sla.selectPolicy(
    [policy({ id: 'low-order', appliesChannel: 'whatsapp', priority: 1 }), policy({ id: 'high-order', appliesChannel: 'whatsapp', priority: 9 })],
    { channel: 'whatsapp' },
  )?.id === 'high-order',
);
check(
  'the tighter target wins when order ties too',
  sla.selectPolicy(
    [
      policy({ id: 'slow', appliesChannel: 'whatsapp', firstResponseMinutes: 60 }),
      policy({ id: 'fast', appliesChannel: 'whatsapp', firstResponseMinutes: 5 }),
    ],
    { channel: 'whatsapp' },
  )?.id === 'fast',
);

console.log(`\n${state.failed === 0 ? '✅' : '❌'} SLA engine: ${state.passed} passed, ${state.failed} failed`);
process.exit(state.failed === 0 ? 0 : 1);
