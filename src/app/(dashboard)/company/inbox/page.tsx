import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { dayKey, formatAbsoluteTime, formatDayGroup, formatRelativeTime } from '@/lib/relative-time';
import { getCompanyId } from '@/modules/company/data';
import { InboxRealtime } from '@/modules/company/components/inbox-realtime';
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
function rowChips(c: ConversationRow, slaMinutes: number): Chip[] {
  const chips: Chip[] = [];
  if (isConversationOverdue(c, slaMinutes)) chips.push({ label: 'Overdue', variant: 'destructive' });
  else if (c.status === 'needs_human') chips.push({ label: 'Waiting for you', variant: 'warning' });
  if (c.priority === 'urgent') chips.push({ label: 'Urgent', variant: 'destructive' });
  if (typeof c.csatRating === 'number' && c.csatRating <= 2) {
    chips.push({ label: `Rated ${c.csatRating}/5`, variant: 'destructive' });
  }
  if (conversationSource(c) === 'connector') chips.push({ label: 'Connector problem', variant: 'destructive' });
  if (c.status === 'human_active') chips.push({ label: 'A person is on it', variant: 'outline' });
  if (c.status === 'closed') chips.push({ label: 'Sorted', variant: 'outline' });
  if (c.status === 'expired') chips.push({ label: 'Went quiet', variant: 'outline' });
  return chips.slice(0, 2);
}

function previewPrefix(sender: string | null): string {
  if (sender === 'agent') return 'You: ';
  if (sender === 'ai') return 'Assistant: ';
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

  const [{ rows, total, page, pageCount, pageSize }, counts, companyId, support] = await Promise.all([
    listConversationsPaged({ page: requestedPage, queue, search }),
    getInboxQueueCounts(),
    getCompanyId(),
    getSupportSettings(),
  ]);

  const now = new Date();
  const activeQueueLabel = INBOX_QUEUES.find((q) => q.key === queue)?.label ?? 'Inbox';
  let lastGroup = '';

  return (
    <div className="space-y-4">
      <InboxRealtime companyId={companyId} />

      <PageHeader
        title="Inbox"
        description="Every chat with your customers and your team."
        actions={
          <Link href="/company/inbox/canned" className="text-sm underline underline-offset-4">
            Saved replies
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        {/* Queue rail. Counts are company-wide, not page-wide, so the rail and
            the list beneath it can never disagree. */}
        <nav aria-label="Conversation queues">
          <ul className="space-y-1">
            {INBOX_QUEUES.map(({ key, label }) => {
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
                    <span>{label}</span>
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
              Search conversations
            </label>
            <input
              id="inbox-search"
              type="search"
              name="q"
              defaultValue={search ?? ''}
              placeholder="Search names, numbers, or what was said…"
              className={searchInputCls}
            />
            <Button type="submit" variant="outline" size="sm">
              Search
            </Button>
            {search ? (
              <Button asChild variant="ghost" size="sm">
                <Link href={queueHref(queue)}>Clear</Link>
              </Button>
            ) : null}
          </form>

          <Card>
            <CardContent className="p-0">
              {rows.length === 0 ? (
                search ? (
                  <EmptyState
                    title={<>Nothing matches &ldquo;{search}&rdquo;</>}
                    body="Try a name, a phone number, or a word the customer used."
                    action={
                      <Button asChild size="sm" variant="outline">
                        <Link href={queueHref(queue)}>Clear the search</Link>
                      </Button>
                    }
                  />
                ) : counts.everything === 0 ? (
                  <EmptyState
                    title="No chats yet"
                    body="Once your assistant is on your website, every chat with a customer lands here."
                    action={
                      <Button asChild size="sm">
                        <Link href="/company/widget">Put it on my website</Link>
                      </Button>
                    }
                  />
                ) : queue === 'waiting' ? (
                  <EmptyState
                    title="Nothing is waiting for you"
                    body="Your assistant is handling everything at the moment."
                    action={
                      <Button asChild size="sm" variant="outline">
                        <Link href={queueHref('everything')}>See every chat</Link>
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState
                    title={`Nothing in ${activeQueueLabel.toLowerCase()}`}
                    body={`There are ${counts.everything} chats in total.`}
                    action={
                      <Button asChild size="sm" variant="outline">
                        <Link href={queueHref('everything')}>See every chat</Link>
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
                    const chips = rowChips(c, support.slaResponseMinutes);
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
                              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                                {c.lastMessagePreview
                                  ? `${previewPrefix(c.lastMessageSender)}${c.lastMessagePreview}`
                                  : 'No messages yet'}
                              </p>
                              {c.assignedAgentName ? (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  Assigned to {c.assignedAgentName}
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
