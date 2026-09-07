import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { dayKey, formatAbsoluteTime, formatDayGroup, formatRelativeTime } from '@/lib/relative-time';
import { t, type Dictionary } from '@/lib/i18n';
import { getRequestDictionary } from '@/lib/i18n/server';
import { getCompanyId } from '@/modules/company/data';
import { InboxRealtime } from '@/modules/company/components/inbox-realtime';
import { PushInboxPrompt } from '@/modules/company/components/push-inbox-prompt';
import { Pagination } from '@/modules/company/components/list-controls';
import {
  conversationDisplayName,
  conversationSource,
  getInboxQueueCounts,
  INBOX_QUEUES,
  isConversationOverdue,
  listConversationsPaged,
  normalizeQueue,
  type ConversationRow,
  type InboxQueue,
} from '@/modules/company/inbox-data';
import { getSupportSettings } from '@/modules/company/support-settings-data';

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

const searchInputCls =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-72';

/**
 * Exceptions only, most urgent first — the first two win. A chat the assistant
 * is quietly handling produces nothing, which is the point.
 */
function rowChips(c: ConversationRow, slaMinutes: number, dict: Dictionary): Chip[] {
  const chips: Chip[] = [];
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

function queueHref(queue: InboxQueue, search?: string): string {
  const params = new URLSearchParams();
  if (queue !== 'waiting') params.set('status', queue);
  if (search) params.set('q', search);
  const qs = params.toString();
  return qs ? `/company/inbox?${qs}` : '/company/inbox';
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams?: { status?: string; q?: string; page?: string };
}) {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const queue = normalizeQueue(searchParams?.status);
  const search = searchParams?.q?.trim() || undefined;
  const requestedPage = Number(searchParams?.page) || 1;

  const [{ rows, total, page, pageCount, pageSize }, counts, companyId, support, dict] =
    await Promise.all([
      listConversationsPaged({ page: requestedPage, queue, search }),
      getInboxQueueCounts(),
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
        {/* Queue rail. Counts are company-wide, not page-wide, so the rail and
            the list beneath it can never disagree. */}
        <nav aria-label={t(dict, 'inbox.queues.label')}>
          <ul className="space-y-1">
            {INBOX_QUEUES.map(({ key }) => {
              const isActive = key === queue;
              return (
                <li key={key}>
                  <Link
                    href={queueHref(key, search)}
                    aria-current={isActive ? 'page' : undefined}
                    className={[
                      'flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm',
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
          <form method="get" action="/company/inbox" className="flex flex-wrap items-center gap-2">
            {queue !== 'waiting' ? <input type="hidden" name="status" value={queue} /> : null}
            <label htmlFor="inbox-search" className="sr-only">
              {t(dict, 'inbox.search.label')}
            </label>
            <input
              id="inbox-search"
              type="search"
              name="q"
              defaultValue={search ?? ''}
              placeholder={t(dict, 'inbox.search.placeholder')}
              className={searchInputCls}
            />
            <Button type="submit" variant="outline" size="sm">
              {t(dict, 'common.search')}
            </Button>
            {search ? (
              <Button asChild variant="ghost" size="sm">
                <Link href={queueHref(queue)}>{t(dict, 'common.clear')}</Link>
              </Button>
            ) : null}
          </form>

          <Card>
            <CardContent className="p-0">
              {rows.length === 0 ? (
                search ? (
                  <EmptyState
                    title={t(dict, 'inbox.empty.search.title', { query: search })}
                    body={t(dict, 'inbox.empty.search.body')}
                    action={
                      <Button asChild size="sm" variant="outline">
                        <Link href={queueHref(queue)}>{t(dict, 'inbox.empty.search.cta')}</Link>
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
                        <Link href={queueHref('everything')}>{t(dict, 'inbox.empty.see_all')}</Link>
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState
                    title={t(dict, 'inbox.empty.queue.title', { queue: activeQueueLabel })}
                    body={t(dict, 'inbox.empty.queue.body', { count: counts.everything })}
                    action={
                      <Button asChild size="sm" variant="outline">
                        <Link href={queueHref('everything')}>{t(dict, 'inbox.empty.see_all')}</Link>
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
                    const chips = rowChips(c, support.slaResponseMinutes, dict);
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
                              <p className="mt-1 line-clamp-2 break-words text-sm text-muted-foreground">
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
                <Pagination
                  basePath="/company/inbox"
                  page={page}
                  pageCount={pageCount}
                  total={total}
                  pageSize={pageSize}
                  search={search}
                  status={queue}
                />
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
