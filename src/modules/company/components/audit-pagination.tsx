import Link from 'next/link';
import { Button } from '@/components/ui/button';
import type { ActivityFilters, ActivityPage } from '@/modules/company/audit-data';

/**
 * Prev/next for the activity log.
 *
 * Separate from `Pagination` in `list-controls` because that one rebuilds the
 * query string from `q` and `status` alone, so paging past the first page of a
 * filtered activity list would have silently dropped the actor, the type and
 * both dates — the filter would appear to work and then quietly stop.
 *
 * The links carry every filter, and page 1 carries no `page` at all, so the
 * unfiltered first page always has exactly one URL.
 */
/**
 * One page of the activity log, as a URL. Exported because the page's
 * "that page is past the end" way out has to land on page 1 of the SAME
 * filters — sending it to the bare path would silently clear them.
 */
export function activityHref(basePath: string, filters: ActivityFilters, page: number): string {
  const params = new URLSearchParams();
  if (filters.actor) params.set('actor', filters.actor);
  if (filters.type) params.set('type', filters.type);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export function AuditPagination({
  basePath,
  filters,
  results,
}: {
  basePath: string;
  filters: ActivityFilters;
  results: ActivityPage;
}) {
  const href = (page: number) => activityHref(basePath, filters, page);
  const { page, pageCount, total, pageSize } = results;
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-muted-foreground">
      <span>{total === 0 ? 'Nothing to show' : `Showing ${first}–${last} of ${total}`}</span>
      <div className="flex items-center gap-2">
        {page <= 1 ? (
          <Button variant="outline" size="sm" disabled>
            Newer
          </Button>
        ) : (
          <Button asChild variant="outline" size="sm">
            <Link href={href(page - 1)}>Newer</Link>
          </Button>
        )}
        <span>
          Page {page} of {pageCount}
        </span>
        {page >= pageCount ? (
          <Button variant="outline" size="sm" disabled>
            Older
          </Button>
        ) : (
          <Button asChild variant="outline" size="sm">
            <Link href={href(page + 1)}>Older</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
