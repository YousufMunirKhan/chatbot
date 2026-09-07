/**
 * Business-hours arithmetic for SLA clocks.
 *
 * Pure functions with no database access so the deadline maths can be tested
 * exhaustively — an SLA that is wrong by an hour is worse than no SLA at all.
 */

export interface BusinessDay {
  /** 0 = Sunday … 6 = Saturday, matching `company_business_hours.day_of_week`. */
  dayOfWeek: number;
  isClosed: boolean;
  /** "09:00" / "09:00:00". Null when closed. */
  openTime: string | null;
  closeTime: string | null;
}

interface Window {
  startMinute: number;
  endMinute: number;
}

const MINUTES_PER_DAY = 24 * 60;

function parseTime(value: string | null): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return Math.min(hours * 60 + minutes, MINUTES_PER_DAY);
}

/** Opening windows keyed by day of week; a day with no usable hours is absent. */
export function buildSchedule(days: BusinessDay[]): Map<number, Window> {
  const schedule = new Map<number, Window>();
  for (const day of days) {
    if (day.isClosed) continue;
    const startMinute = parseTime(day.openTime);
    const endMinute = parseTime(day.closeTime);
    if (startMinute === null || endMinute === null || endMinute <= startMinute) continue;
    schedule.set(day.dayOfWeek, { startMinute, endMinute });
  }
  return schedule;
}

function minuteOfDay(date: Date): number {
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

function atMinute(date: Date, minute: number): Date {
  const next = new Date(date);
  next.setUTCHours(0, 0, 0, 0);
  return new Date(next.getTime() + minute * 60_000);
}

function startOfNextDay(date: Date): Date {
  const next = new Date(date);
  next.setUTCHours(0, 0, 0, 0);
  return new Date(next.getTime() + MINUTES_PER_DAY * 60_000);
}

/**
 * Add `minutes` of *open* time to `from`.
 *
 * Times are treated as UTC throughout: the stored opening hours are wall-clock
 * values for the company's own timezone, and callers pass a `from` already
 * shifted into that timezone, so mixing zones here is impossible by
 * construction.
 *
 * Returns a plain elapsed-time deadline when the schedule is empty, so a company
 * that has not filled in its opening hours still gets a working SLA.
 */
export function addBusinessMinutes(from: Date, minutes: number, schedule: Map<number, Window>): Date {
  if (minutes <= 0) return new Date(from);
  if (schedule.size === 0) return new Date(from.getTime() + minutes * 60_000);

  let remaining = minutes;
  let cursor = new Date(from);

  // A week of closed days is the worst case; 14 iterations covers it twice over
  // and guarantees termination even for a nonsensical schedule.
  for (let guard = 0; guard < 14 && remaining > 0; guard += 1) {
    const window = schedule.get(cursor.getUTCDay());
    if (!window) {
      cursor = startOfNextDay(cursor);
      continue;
    }

    const windowEnd = atMinute(cursor, window.endMinute);
    if (cursor >= windowEnd) {
      cursor = startOfNextDay(cursor);
      continue;
    }

    // Before opening: the clock starts when the doors do.
    const windowStart = atMinute(cursor, window.startMinute);
    const effectiveStart = cursor > windowStart ? cursor : windowStart;

    // Arithmetic stays in milliseconds. Rounding the start down to a whole
    // minute would quietly shorten every target by up to 59 seconds — a 30
    // minute SLA would be due in 29.4.
    const availableMs = windowEnd.getTime() - effectiveStart.getTime();
    const neededMs = remaining * 60_000;

    if (availableMs >= neededMs) {
      return new Date(effectiveStart.getTime() + neededMs);
    }
    remaining -= availableMs / 60_000;
    cursor = startOfNextDay(cursor);
  }

  // Schedule exhausted (e.g. every day closed): fall back to elapsed time so a
  // deadline always exists.
  return new Date(from.getTime() + minutes * 60_000);
}

/** Minutes of open time between two instants — used to report actual response times. */
export function businessMinutesBetween(start: Date, end: Date, schedule: Map<number, Window>): number {
  if (end <= start) return 0;
  if (schedule.size === 0) return Math.round((end.getTime() - start.getTime()) / 60_000);

  let total = 0;
  let cursor = new Date(start);
  for (let guard = 0; guard < 366 && cursor < end; guard += 1) {
    const window = schedule.get(cursor.getUTCDay());
    if (window) {
      const dayStart = atMinute(cursor, window.startMinute);
      const dayEnd = atMinute(cursor, window.endMinute);
      const from = cursor > dayStart ? cursor : dayStart;
      const to = end < dayEnd ? end : dayEnd;
      if (to > from) total += (to.getTime() - from.getTime()) / 60_000;
    }
    cursor = startOfNextDay(cursor);
  }
  return Math.round(total);
}

export function isWithinBusinessHours(at: Date, schedule: Map<number, Window>): boolean {
  if (schedule.size === 0) return true;
  const window = schedule.get(at.getUTCDay());
  if (!window) return false;
  const minute = minuteOfDay(at);
  return minute >= window.startMinute && minute < window.endMinute;
}

/**
 * Timezone handling.
 *
 * Opening hours are stored as wall-clock strings ("09:00") with no zone, and
 * the arithmetic above reads UTC fields. So an instant has to be moved into the
 * company's own wall-clock frame before the maths and moved back afterwards.
 * Without this a shop in Karachi with 09:00–17:00 hours was really being
 * treated as open 14:00–22:00 local, and every business-hours SLA was wrong by
 * the company's UTC offset.
 *
 * `Intl` does the zone lookup, so DST is handled by the platform rather than by
 * a table we would have to maintain.
 */

/** Minutes `timeZone` is ahead of UTC at this instant (negative when behind). */
export function zoneOffsetMinutes(at: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(at);

    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
    // hourCycle h23 still renders midnight as "24" in some ICU versions.
    const hour = get('hour') % 24;
    const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
    return Math.round((asIfUtc - at.getTime()) / 60_000);
  } catch {
    // An unknown or missing zone means "treat the stored hours as UTC", which is
    // the behaviour that existed before and never throws at a customer.
    return 0;
  }
}

/** Move an instant into the zone's wall-clock frame for the arithmetic above. */
export function toZonedTime(at: Date, timeZone: string | null | undefined): Date {
  if (!timeZone) return at;
  return new Date(at.getTime() + zoneOffsetMinutes(at, timeZone) * 60_000);
}

/**
 * Move a wall-clock result back to a real instant.
 *
 * The offset is re-read at the computed instant, so a deadline that lands on the
 * far side of a DST change uses that day's offset rather than today's.
 */
export function fromZonedTime(wallClock: Date, timeZone: string | null | undefined): Date {
  if (!timeZone) return wallClock;
  const firstGuess = new Date(wallClock.getTime() - zoneOffsetMinutes(wallClock, timeZone) * 60_000);
  return new Date(wallClock.getTime() - zoneOffsetMinutes(firstGuess, timeZone) * 60_000);
}
