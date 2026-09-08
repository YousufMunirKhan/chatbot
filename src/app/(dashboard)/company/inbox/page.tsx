import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { dayKey, formatAbsoluteTime, formatDayGroup, formatRelativeTime } from '@/lib/relative-time';
import { t, tOr, type Dictionary } from '@/lib/i18n';
import { getRequestDictionary } from '@/lib/i18n/server';
import { getCompanyId } from '@/modules/company/data';
import { InboxRealtime } from '@/modules/company/components/inbox-realtime';
import { PushInboxPrompt } from '@/modules/company/components/push-inbox-prompt';
import { InboxFilterBar, InboxPagination } from '@/modules/company/components/inbox-filters';
import {
  conversationDisplayName,
  conversationSource,
  getInboxQueueCounts,
  hasInboxFilters,
  inboxHref,
  INBOX_QUEUES,
  isConversationOverdue,
  isSnoozed,
  listConversationsPaged,
  listInboxFilterOptions,
  normalizeQueue,
  parseInboxFilters,
  type ConversationRow,
  type InboxFilters,
  type InboxQueue,
} from '@/modules/company/inbox-data';
import { getSupportSettings } from '@/modules/company/support-settings-data';
import { timeUntilLabel } from '@/modules/company/components/inbox-snooze-presets';

/**
 * The inbox is a queue, not a report.
 *
 * What changed and why:
 *  - Eight columns became one row. Every row used to wrap eight separate
 *    `<Link>` elements, so reaching row 40 by keyboard took 320 tab presses and
 *    the `cursor-pointer` on the row was a lie. Now: one link, one tab stop.
 *  - A message preview exists at all, which is the only column that lets an
 *    agent triage without opening the conversation.
 *  - Chips are for exceptions only. "AI is handling this" is the default state
 *    and gets no chip, which removes roughly 60% of the old badge volume, and
 *    no row ever shows more than two.
 *  - Timestamps are relative, with the absolute time on hover.
 */

type BadgeVariant = 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline';
type Chip = { label: string; variant: BadgeVariant };

/**
 * Exceptions only, most urgent first — the first two win. A chat the assistant
 * is quietly handling produces nothing, which is the point.
 */
function rowChips(c: ConversationRow, slaMinutes: number, dict: Dictionary, now: Date): Chip[] {
  const chips: Chip[] = [];
  // First, because it explains why a row that looks like work is not: it is in
  // "Everything" or in a filtered view, put aside until a time someone chose.
  if (isSnoozed(c, now)) {
    // NOTE: still hard-coded English, as are the two filter empty states below
    // it. `tOr` cannot help here — it returns its fallback verbatim without
    // interpolating, so a `{time}` placeholder would reach the badge as text.
    // Closing this needs `inbox.chip.snoozed` in en.ts and ar.ts, which are
    // another workstream's files this week.
    chips.push({ label: `Back in ${timeUntilLabel(c.snoozedUntil, now)}`, variant: 'secondary' });
  }
  if (isConversationOverdue(c, slaMinutes))
    chips.push({ label: t(dict, 'inbox.chip.overdue'), variant: 'destructive' });
  else if (c.status === 'needs_human')
    chips.push({ label: t(dict, 'inbox.chip.waiting'), variant: 'warning' });
  if (c.priority === 'urgent') chips.push({ label: t(dict, 'inbox.chip.urgent'), variant: 'destructive' });
  if (typeof c.csatRating === 'number' && c.csatRating <= 2) {
    chips.push({
      label: t(dict, 'inbox.chip.rated', { rating: c.csatRating }),
      variant: 'destructive',
    });
  }
  if (conversationSource(c) === 'connector')
    chips.push({ label: t(dict, 'inbox.chip.connector'), variant: 'destructive' });
  if (c.status === 'human_active')
    chips.push({ label: t(dict, 'inbox.chip.human'), variant: 'outline' });
  if (c.status === 'closed') chips.push({ label: t(dict, 'inbox.chip.closed'), variant: 'outline' });
  if (c.status === 'expired') chips.push({ label: t(dict, 'inbox.chip.expired'), variant: 'outline' });
  return chips.slice(0, 2);
}

function previewPrefix(sender: string | null, dict: Dictionary): string {
  if (sender === 'agent') return t(dict, 'inbox.preview.you');
  if (sender === 'ai') return t(dict, 'inbox.preview.assistant');
  return '';
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams?: {
    status?: string;
    q?: string;
    page?: string;
    channel?: string;
    assignee?: string;
    tag?: string;
    from?: string;
    to?: string;
  };
}) {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const queue = normalizeQueue(searchParams?.status);
  const search = searchParams?.q?.trim() || undefined;
  const filters: InboxFilters = parseInboxFilters(searchParams);
  const requestedPage = Number(searchParams?.page) || 1;

  // The filter options are one extra round trip and buy both halves of the
  // filter bar; the filters themselves ride along inside the queue's own query,
  // so narrowing the list costs nothing. The page's budget is asserted by
  // scripts/test-query-counts.mjs.
  const [{ rows, total, page, pageCount, pageSize }, counts, filterOptions, companyId, support, dict] =
    await Promise.all([
      listConversationsPaged({ page: requestedPage, queue, search, filters }),
      getInboxQueueCounts(),
      listInboxFilterOptions(),
      getCompanyId(),
      getSupportSettings(),
      getRequestDictionary(),
    ]);

  const now = new Date();
  // Queue labels come from the dictionary keyed by queue, so the rail and the
  // empty state can never disagree about what a queue is called.
  const queueLabel = (key: InboxQueue) =>
    t(dict, `inbox.queue.${key}`, {}) === `inbox.queue.${key}`
      ? (INBOX_QUEUES.find((q) => q.key === key)?.label ?? key)
      : t(dict, `inbox.queue.${key}`);
  const activeQueueLabel = queueLabel(queue);
  const filtered = hasInboxFilters(filters);
  let lastGroup = '';

  return (
    <div className="space-y-4">
      <InboxRealtime companyId={companyId} />

      <PageHeader
        title={t(dict, 'inbox.title')}
        description={t(dict, 'inbox.description')}
        actions={
          <Link href="/company/inbox/canned" className="text-sm underline underline-offset-4">
            {t(dict, 'inbox.saved_replies')}
          </Link>
        }
      />

      {/* Offered from the second inbox visit onwards, never on first paint. */}
      <PushInboxPrompt />

      {/* `min-w-0` on both tracks: a grid item defaults to min-width:auto, so one
          long unbroken message preview stretched the column to 672px on a
          375px phone and pulled the queue rail out with it. */}
      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)] [&>*]:min-w-0">
        {/* Queue rail. Counts are company-wide, not page-wide: the search box
            never narrowed them and neither do the filters, so the rail keeps
            telling an agent working a filtered view how much work is really
            sitting in each queue. Switching queue carries the search and the
            filters with it, because "the same slice, different queue" is what
            the rail is for. */}
        {/* Below `lg` the rail is a horizontal scroller, not a stack. As a
            column it put five rows and their counts between the page heading
            and the first chat, so a 375px phone opened the inbox showing the
            queue names and one and a half conversations. Same links, same
            counts, same order — laid along the axis that has room.

            The links had no focus style of their own, so keyboard users got the
            browser's default outline, which a scroll container clips. The ring
            is `inset` for that reason. */}
        <nav
          aria-label={t(dict, 'inbox.queues.label')}
          className="overflow-x-auto pb-1 lg:overflow-visible lg:pb-0"
        >
          <ul className="flex min-w-max gap-1 lg:min-w-0 lg:flex-col">
            {INBOX_QUEUES.map(({ key }) => {
              const isActive = key === queue;
              return (
                <li key={key} className="shrink-0">
                  <Link
                    href={inboxHref({ queue: key, search, filters })}
                    aria-current={isActive ? 'page' : undefined}
                    className={[
                      'flex items-center justify-between gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                      isActive ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted/50',
                    ].join(' ')}
                  >
                    <span>{queueLabel(key)}</span>
                    <span className="tabular-nums text-xs">{counts[key]}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="space-y-3">
          <InboxFilterBar queue={queue} search={search} filters={filters} options={filterOptions} />

          <Card>
            <CardContent className="p-0">
              {rows.length === 0 ? (
                search ? (
                  <EmptyState
                    title={t(dict, 'inbox.empty.search.title', { query: search })}
                    body={t(dict, 'inbox.empty.search.body')}
                    action={
                      <Button asChild size="sm" variant="outline">
                        <Link href={inboxHref({ queue })}>{t(dict, 'inbox.empty.search.cta')}</Link>
                      </Button>
                    }
                  />
                ) : filtered ? (
                  // Its own state, because "nothing here" and "nothing here
                  // that matches what you asked for" are different facts and
                  // the second one has an obvious next move.
                  <EmptyState
                    title={tOr(dict, 'inbox.empty.filtered.title', 'Nothing matches those filters')}
                    body={`${activeQueueLabel} has ${counts[queue]} chat${counts[queue] === 1 ? '' : 's'} in it, but none of them match the filters you set.`}
                    action={
                      <Button asChild size="sm" variant="outline">
                        <Link href={inboxHref({ queue })}>
                          {tOr(dict, 'inbox.empty.filtered.cta', 'Clear the filters')}
                        </Link>
                      </Button>
                    }
                  />
                ) : counts.everything === 0 ? (
                  <EmptyState
                    title={t(dict, 'inbox.empty.none.title')}
                    body={t(dict, 'inbox.empty.none.body')}
                    action={
                      <Button asChild size="sm">
                        <Link href="/company/widget">{t(dict, 'inbox.empty.none.cta')}</Link>
                      </Button>
                    }
                  />
                ) : queue === 'waiting' ? (
                  <EmptyState
                    title={t(dict, 'inbox.empty.waiting.title')}
                    body={t(dict, 'inbox.empty.waiting.body')}
                    action={
                      <Button asChild size="sm" variant="outline">
                        <Link href={inboxHref({ queue: 'everything' })}>{t(dict, 'inbox.empty.see_all')}</Link>
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState
                    title={t(dict, 'inbox.empty.queue.title', { queue: activeQueueLabel })}
                    body={t(dict, 'inbox.empty.queue.body', { count: counts.everything })}
                    action={
                      <Button asChild size="sm" variant="outline">
                        <Link href={inboxHref({ queue: 'everything' })}>{t(dict, 'inbox.empty.see_all')}</Link>
                      </Button>
                    }
                  />
                )
              ) : (
                <ul className="divide-y">
                  {rows.map((c) => {
                    const group = dayKey(c.lastMessageAt);
                    const showHeader = group !== lastGroup;
                    lastGroup = group;
                    const { label, suffix } = conversationDisplayName(c);
                    const chips = rowChips(c, support.slaResponseMinutes, dict, now);
                    const unread = c.unreadCount > 0;

                    return (
                      <li key={c.id}>
                        {showHeader ? (
                          <p className="bg-muted/40 px-4 py-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                            {formatDayGroup(c.lastMessageAt, now)}
                          </p>
                        ) : null}
                        {/* One link, one tab stop, the whole row. */}
                        <Link
                          href={`/company/inbox/${c.id}`}
                          className="block px-4 py-3 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className={unread ? 'text-sm font-semibold' : 'text-sm font-medium'}>
                                  {label}
                                  {suffix ? (
                                    <span className="font-normal text-muted-foreground"> · {suffix}</span>
                                  ) : null}
                                </span>
                                {chips.map((chip) => (
                                  <Badge key={chip.label} variant={chip.variant}>
                                    {chip.label}
                                  </Badge>
                                ))}
                              </div>
                              {/* An unread row darkens its preview as well as
                                  bolding the name: a single weight step on one
                                  line is a signal you have to already know to
                                  look for. */}
                              <p
                                className={`mt-1 line-clamp-2 break-words text-sm ${
                                  unread ? 'text-foreground' : 'text-muted-foreground'
                                }`}
                              >
                                {c.lastMessagePreview
                                  ? `${previewPrefix(c.lastMessageSender, dict)}${c.lastMessagePreview}`
                                  : t(dict, 'inbox.preview.none')}
                              </p>
                              {c.assignedAgentName ? (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {t(dict, 'inbox.assigned', { name: c.assignedAgentName })}
                                </p>
                              ) : null}
                            </div>
                            <time
                              dateTime={c.lastMessageAt ?? undefined}
                              title={formatAbsoluteTime(c.lastMessageAt)}
                              className="shrink-0 text-xs text-muted-foreground"
                            >
                              {formatRelativeTime(c.lastMessageAt, now)}
                            </time>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}

              {total > pageSize ? (
                <InboxPagination
                  queue={queue}
                  search={search}
                  filters={filters}
                  page={page}
                  pageCount={pageCount}
                  total={total}
                  pageSize={pageSize}
                />
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
