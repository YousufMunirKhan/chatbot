/**
 * Relative timestamp formatting for the inbox.
 *
 * `formatDate` in `@/lib/format` deliberately renders a calendar date only, which
 * is right for a leads table but wrong for a conversation queue: on a busy day
 * every row reads "Aug 21, 2026" and the column throws away the information the
 * sort order carries. These helpers give the agent the age of a message at a
 * glance, and pair with `formatAbsoluteTime` in a `title` attribute so the exact
 * time is always one hover away.
 *
 * Everything takes an explicit `now` so the output is testable and so a single
 * render pass groups rows against one consistent clock.
 */

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? null : date;
}

function timeOfDay(date: Date): string {
  // en-GB gives a 24-hour "14:20" without an AM/PM suffix eating column width.
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function dayAndMonth(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/**
 * "just now" · "12m ago" · "3h ago" · "Tue 14:20" · "14 Aug" · "14 Aug 2025".
 *
 * Anything in the future (clock skew between the browser and the database)
 * collapses to "just now" rather than rendering a negative age.
 */
export function formatRelativeTime(
  value: string | Date | null | undefined,
  now: Date = new Date(),
): string {
  const date = toDate(value);
  if (!date) return '—';

  const diffMs = now.getTime() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${date.toLocaleDateString('en-US', { weekday: 'short' })} ${timeOfDay(date)}`;

  return date.getFullYear() === now.getFullYear()
    ? dayAndMonth(date)
    : `${dayAndMonth(date)} ${date.getFullYear()}`;
}

/** Full date and time for a `title` attribute — "14 Aug 2026, 14:20". */
export function formatAbsoluteTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return 'No date recorded';
  return `${dayAndMonth(date)} ${date.getFullYear()}, ${timeOfDay(date)}`;
}

/** Heading for a date group in a list — "Today", "Yesterday", "Tuesday", "14 Aug 2026". */
export function formatDayGroup(
  value: string | Date | null | undefined,
  now: Date = new Date(),
): string {
  const date = toDate(value);
  if (!date) return 'No date';

  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);

  if (dayDiff === 0) return 'Today';
  if (dayDiff === 1) return 'Yesterday';
  if (dayDiff > 1 && dayDiff < 7) return date.toLocaleDateString('en-US', { weekday: 'long' });
  return date.getFullYear() === now.getFullYear()
    ? dayAndMonth(date)
    : `${dayAndMonth(date)} ${date.getFullYear()}`;
}

/** Stable key for grouping rows by calendar day. */
export function dayKey(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return 'unknown';
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
