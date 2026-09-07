import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Select } from '@/components/ui/select';
import { labelFor } from '@/lib/constants';

/**
 * Shared, server-rendered list controls for the leads / appointments tables:
 * a GET filter form (search + status) and prev/next pagination. No client JS —
 * filters submit as a normal form and pagination is plain links, so these work
 * inside server components.
 */

// The select here is now `<Select size="sm">`. `inputCls` survives because the
// filter bar runs its controls at 36px and `Input` is fixed at 40px with no
// size variant — the one control that could not adopt its primitive.
const inputCls =
  'flex h-9 w-56 rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

// One filter bar per page, so fixed ids are safe and keep the label wiring
// readable. If a page ever renders two, give each its own `idPrefix`.
const SEARCH_ID = 'list-filter-search';
const STATUS_ID = 'list-filter-status';

export function ListFilters({
  basePath,
  search,
  status,
  statuses,
  placeholder = 'Search…',
  searchLabel = 'Search',
  statusLabel = 'Status',
  statusLabels = {},
}: {
  basePath: string;
  search?: string;
  status?: string;
  statuses: readonly string[];
  placeholder?: string;
  /** Visible label for the search box — say what this list is searched by. */
  searchLabel?: string;
  /** Visible label for the status dropdown. */
  statusLabel?: string;
  /**
   * Display names for the status values, supplied by the caller (bookings pass
   * `APPOINTMENT_STATUS_LABELS`, leads pass theirs). This component cannot pick
   * the map itself — the same `pending` means different things on different
   * lists — and without one the options degrade through `labelFor` to
   * `humanizeToken` rather than to the raw `no_show` fragment they used to show.
   */
  statusLabels?: Record<string, string>;
}) {
  return (
    <form method="get" action={basePath} className="flex flex-wrap items-end gap-2">
      <FormField label={searchLabel} htmlFor={SEARCH_ID}>
        <input
          type="text"
          name="q"
          defaultValue={search ?? ''}
          placeholder={placeholder}
          className={inputCls}
        />
      </FormField>
      {/* `w-auto`: this select sizes to its options in the filter row, where
          `Select`'s default `w-full` would stretch it across the bar. */}
      <FormField label={statusLabel} htmlFor={STATUS_ID}>
        <Select size="sm" name="status" defaultValue={status ?? 'all'} className="w-auto">
          <option value="all">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {labelFor(statusLabels, s)}
            </option>
          ))}
        </Select>
      </FormField>
      <Button type="submit" variant="outline" size="sm">
        Filter
      </Button>
      {(search || (status && status !== 'all')) && (
        <Button asChild variant="ghost" size="sm">
          <Link href={basePath}>Clear</Link>
        </Button>
      )}
    </form>
  );
}

export function Pagination({
  basePath,
  page,
  pageCount,
  total,
  pageSize,
  search,
  status,
}: {
  basePath: string;
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  search?: string;
  status?: string;
}) {
  const href = (p: number) => {
    const params = new URLSearchParams();
    if (search) params.set('q', search);
    if (status && status !== 'all') params.set('status', status);
    if (p > 1) params.set('page', String(p));
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
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
