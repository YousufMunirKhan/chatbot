/**
 * WhatsApp's 24-hour customer service window.
 *
 * Meta delivers a free-form ("session") message only within 24 hours of the
 * customer's last inbound message. Outside that window nothing but an approved
 * template goes through, and a business that keeps trying anyway loses quality
 * rating on its number — which is the customer's asset, not ours. So the send
 * path has to know where the window stands before it posts anything.
 *
 * Pure functions with no database access: the caller supplies the timestamp and
 * `now`, which is what lets the arithmetic be tested exhaustively — the same
 * reason `@/lib/sla/schedule` is pure.
 */

/** Meta's window. Not configurable, because it is their rule and not ours. */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface ServiceWindow {
  /** True while a free-form text is still deliverable. */
  isOpen: boolean;
  /** Milliseconds of free-form sending left; zero once the window has closed. */
  remainingMs: number;
  /**
   * Milliseconds since the customer's last inbound message. Null when they have
   * never written to us — which is a closed window, not a fresh one.
   */
  elapsedMs: number | null;
  /** When the window closes, or closed. Null when there is nothing to measure from. */
  expiresAt: Date | null;
}

/**
 * Accept whatever a caller or the database hands over.
 *
 * Supabase returns timestamps as ISO strings, and an unparseable value has to
 * read as "no inbound message" rather than as an Invalid Date, which compares
 * false in every direction and would quietly make the window look open.
 */
export function toInstant(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Where the window stands at `now`, given the customer's last inbound message. */
export function evaluateServiceWindow(
  lastInboundAt: Date | string | number | null | undefined,
  now: Date,
): ServiceWindow {
  const last = toInstant(lastInboundAt);
  if (!last) return { isOpen: false, remainingMs: 0, elapsedMs: null, expiresAt: null };

  const expiresAt = new Date(last.getTime() + SERVICE_WINDOW_MS);

  // Arithmetic stays in milliseconds. Truncating to whole minutes would let a
  // send through up to 59 seconds after Meta has already closed the window, and
  // that rejection lands on the company's quality rating rather than in a test.
  const elapsedMs = now.getTime() - last.getTime();
  const remainingMs = expiresAt.getTime() - now.getTime();

  // An inbound timestamp in the future is clock skew between us and the
  // provider, not a longer window, so the remainder never exceeds 24 hours.
  const clamped = Math.min(Math.max(remainingMs, 0), SERVICE_WINDOW_MS);

  return { isOpen: remainingMs > 0, remainingMs: clamped, elapsedMs, expiresAt };
}

/** "1h 4m" / "45m" / "20s" — for a human reading a log line, never for maths. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${totalSeconds}s`;
}

/**
 * The sentence an operator reads when a send is refused, phrased so it explains
 * both what happened and what would work instead. Null while the window is
 * open, so a caller can use it as the whole decision.
 */
export function serviceWindowRefusalReason(serviceWindow: ServiceWindow): string | null {
  if (serviceWindow.isOpen) return null;
  if (serviceWindow.elapsedMs === null) {
    return (
      'Outside the WhatsApp 24h customer service window: this contact has never messaged ' +
      'this number, so only an approved template may be sent.'
    );
  }
  return (
    `Outside the WhatsApp 24h customer service window: the last inbound message was ` +
    `${formatDuration(serviceWindow.elapsedMs)} ago, so only an approved template may be sent.`
  );
}
