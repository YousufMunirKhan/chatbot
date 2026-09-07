import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { formatAbsoluteTime, formatRelativeTime } from '@/lib/relative-time';
import type { ActivityEntry } from '@/modules/company/audit-data';

/**
 * The activity log itself: one line per entry, in the reader's words.
 *
 * A table was the obvious shape and the wrong one. The interesting part of an
 * entry is a sentence of variable length, and the supporting facts differ per
 * action — a plan change carries limits, a stock edit carries two quantities —
 * so a fixed column grid would have been mostly empty cells with the real
 * content squeezed into one of them.
 *
 * TIME
 * ----
 * The visible time is relative ("3h ago"), which means the same thing in every
 * timezone. The exact time, on hover, is rendered on the COMPANY's clock — the
 * same clock the date filter counts days on, so an entry the filter puts on the
 * 3rd cannot show a date of the 2nd when you point at it.
 */

function exactTime(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso));
  } catch {
    // `companies.timezone` is free text and can hold something ICU rejects.
    return formatAbsoluteTime(iso);
  }
}

export function AuditEntries({
  entries,
  timezone,
}: {
  entries: ActivityEntry[];
  /** The company's own timezone, for the exact time behind each row. */
  timezone: string;
}) {
  return (
    <ul className="divide-y">
      {entries.map((entry) => (
        <li key={entry.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3.5">
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="text-sm font-medium">{entry.sentence}</p>

            {entry.details.length ? (
              <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                {entry.details.map((detail) => (
                  <div key={detail.label} className="min-w-0">
                    <dt className="inline">{detail.label}: </dt>
                    <dd className="inline break-words text-foreground">{detail.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}

            {entry.link ? (
              <Link
                href={entry.link.href}
                className="inline-block text-xs underline underline-offset-4 hover:no-underline"
              >
                {entry.link.label}
              </Link>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {/* Not hidden, and not softened. An operator changing a customer's
                plan is precisely what the customer is owed a record of. */}
            {entry.byOperator ? <Badge variant="info">Support team</Badge> : null}
            <span className="text-xs text-muted-foreground" title={exactTime(entry.createdAt, timezone)}>
              {formatRelativeTime(entry.createdAt)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
