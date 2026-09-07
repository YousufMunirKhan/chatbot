import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Select } from '@/components/ui/select';
import { CHANNEL_LABELS, CHANNELS, labelFor } from '@/lib/constants';
import {
  hasInboxFilters,
  inboxHref,
  INBOX_ASSIGNEE_ME,
  INBOX_ASSIGNEE_UNASSIGNED,
  type InboxFilterOptions,
  type InboxFilters,
  type InboxQueue,
} from '../inbox-data';

/**
 * The inbox filter bar and pager.
 *
 * Server-rendered on purpose, like the shared `ListFilters` next door: a GET
 * form and plain links need no JavaScript, so filtering the queue works before
 * the page has hydrated. It is a separate component from the shared one because
 * the inbox filters on four things the leads and bookings tables do not have,
 * and because the shared `Pagination` only knows how to carry `q`, `status` and
 * `page` — pressing Next there would silently drop the filters the agent just
 * set. Both halves build their links through `inboxHref`, so there is one
 * definition of what the inbox's URL means.
 *
 * The controls run at `h-9` to match the other filter bars in the dashboard.
 */
const inputCls =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function InboxFilterBar({
  queue,
  search,
  filters,
  options,
}: {
  queue: InboxQueue;
  search?: string;
  filters: InboxFilters;
  options: InboxFilterOptions;
}) {
  const isFiltered = Boolean(search) || hasInboxFilters(filters);
  return (
    <form method="get" action="/company/inbox" className="flex flex-wrap items-end gap-2">
      {/* The queue is part of the address, not of the filter, so it rides along
          rather than being reset by a filter change. */}
      {queue !== 'waiting' ? <input type="hidden" name="status" value={queue} /> : null}

      <FormField label="Search" htmlFor="inbox-search">
        <input
          id="inbox-search"
          type="search"
          name="q"
          defaultValue={search ?? ''}
          placeholder="Name, email or message text"
          className={`${inputCls} sm:w-64`}
        />
      </FormField>

      <FormField label="Channel" htmlFor="inbox-channel">
        <Select
          id="inbox-channel"
          name="channel"
          size="sm"
          defaultValue={filters.channel ?? ''}
          className="w-auto"
        >
          <option value="">Any channel</option>
          {CHANNELS.map((channel) => (
            <option key={channel} value={channel}>
              {labelFor(CHANNEL_LABELS, channel)}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField label="Assignee" htmlFor="inbox-assignee">
        <Select
          id="inbox-assignee"
          name="assignee"
          size="sm"
          defaultValue={filters.assignee ?? ''}
          className="w-auto"
        >
          <option value="">Anyone</option>
          <option value={INBOX_ASSIGNEE_ME}>Me</option>
          <option value={INBOX_ASSIGNEE_UNASSIGNED}>Nobody yet</option>
          {options.members.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.name}
            </option>
          ))}
        </Select>
      </FormField>

      {/* A text input with suggestions rather than a dropdown: the tag list is
          whatever this company has typed, so it can be empty, and an agent who
          knows the tag should not have to wait for a list to offer it. */}
      <FormField label="Tag" htmlFor="inbox-tag">
        <input
          id="inbox-tag"
          type="text"
          name="tag"
          list="inbox-tag-options"
          defaultValue={filters.tag ?? ''}
          placeholder="Any tag"
          className={`${inputCls} w-36`}
        />
      </FormField>
      <datalist id="inbox-tag-options">
        {options.tags.map((tag) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>

      <FormField label="Active from" htmlFor="inbox-from">
        <input
          id="inbox-from"
          type="date"
          name="from"
          defaultValue={filters.from ?? ''}
          className={`${inputCls} w-40`}
        />
      </FormField>

      <FormField label="to" htmlFor="inbox-to">
        <input
          id="inbox-to"
          type="date"
          name="to"
          defaultValue={filters.to ?? ''}
          className={`${inputCls} w-40`}
        />
      </FormField>

      <Button type="submit" variant="outline" size="sm">
        Filter
      </Button>
      {isFiltered ? (
        <Button asChild variant="ghost" size="sm">
          <Link href={inboxHref({ queue })}>Clear</Link>
        </Button>
      ) : null}
    </form>
  );
}

export function InboxPagination({
  queue,
  search,
  filters,
  page,
  pageCount,
  total,
  pageSize,
}: {
  queue: InboxQueue;
  search?: string;
  filters: InboxFilters;
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
}) {
  const href = (target: number) => inboxHref({ queue, search, filters, page: target });
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-muted-foreground">
      <span>{total === 0 ? 'No results' : `Showing ${from}–${to} of ${total}`}</span>
      <div className="flex items-center gap-2">
        {page <= 1 ? (
          <Button variant="outline" size="sm" disabled>
            Previous
          </Button>
        ) : (
          <Button asChild variant="outline" size="sm">
            <Link href={href(page - 1)}>Previous</Link>
          </Button>
        )}
        <span>
          Page {page} of {pageCount}
        </span>
        {page >= pageCount ? (
          <Button variant="outline" size="sm" disabled>
            Next
          </Button>
        ) : (
          <Button asChild variant="outline" size="sm">
            <Link href={href(page + 1)}>Next</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
