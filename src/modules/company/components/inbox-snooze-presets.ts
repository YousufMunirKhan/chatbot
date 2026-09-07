/**
 * The snooze durations, shared by the control that offers them and the action
 * that applies them.
 *
 * They live in their own module with no imports at all because both sides need
 * them: the panel is a `'use client'` component and the action is a
 * `'use server'` module, and neither can export a plain object to the other —
 * a `'use server'` module may only export async functions, and a value imported
 * from a client module into a server one compiles, type-checks and then renders
 * nothing. A file with no dependencies is safe to pull into either bundle.
 *
 * Durations rather than clock times ("tomorrow morning") on purpose: a duration
 * needs no timezone to be exact, and the custom picker below it covers the case
 * where the agent means a particular moment. The labels say what they do.
 */
export interface SnoozePreset {
  key: string;
  label: string;
  minutes: number;
}

export const SNOOZE_PRESETS: readonly SnoozePreset[] = [
  { key: '1h', label: '1 hour', minutes: 60 },
  { key: '3h', label: '3 hours', minutes: 180 },
  { key: '1d', label: '1 day', minutes: 60 * 24 },
  { key: '1w', label: '1 week', minutes: 60 * 24 * 7 },
];

export function snoozePresetMinutes(key: string | null | undefined): number | null {
  return SNOOZE_PRESETS.find((preset) => preset.key === key)?.minutes ?? null;
}

/** A year out. Past this, an agent means "close it", not "remind me". */
export const MAX_SNOOZE_DAYS = 365;

/**
 * How long until a moment in the future: "20m", "3h", "2d".
 *
 * `formatRelativeTime` only speaks about the past — anything ahead of `now`
 * collapses to "just now" there, on purpose, so that clock skew never renders a
 * negative age. A snooze is entirely about the future, so it needs its own
 * phrasing rather than a caption reading "back just now" about next Tuesday.
 */
export function timeUntilLabel(value: string | null | undefined, now: Date = new Date()): string {
  if (!value) return '';
  const minutes = Math.round((new Date(value).getTime() - now.getTime()) / 60_000);
  if (!Number.isFinite(minutes) || minutes <= 0) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
