import Link from 'next/link';
import { Button } from '@/components/ui/button';

/**
 * Shared, server-rendered list controls for the leads / appointments tables:
 * a GET filter form (search + status) and prev/next pagination. No client JS —
 * filters submit as a normal form and pagination is plain links, so these work
 * inside server components.
 */

const inputCls =
  'flex h-9 w-56 rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const selectCls =
  'flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function ListFilters({
  basePath,
  search,
  status,
  statuses,
  placeholder = 'Search…',
}: {
  basePath: string;
  search?: string;
  status?: string;
  statuses: readonly string[];
  placeholder?: string;
}) {
  return (
    <form method="get" action={basePath} className="flex flex-wrap items-end gap-2">
      <input
        type="text"
        name="q"
        defaultValue={search ?? ''}
        placeholder={placeholder}
        className={inputCls}
      />
      <select name="status" defaultValue={status ?? 'all'} className={selectCls}>
        <option value="all">All statuses</option>
        {statuses.map((s) => (
          <option key={s} value={s}>
            {s.replace(/_/g, ' ')}
          </option>
        ))}
      </select>
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
