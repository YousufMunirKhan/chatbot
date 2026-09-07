import Link from 'next/link';
import { RefreshOnFocus } from '@/components/refresh-on-focus';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { getCompanyActivity, normaliseActivityFilters } from '@/modules/company/audit-data';
import { AuditEntries } from '@/modules/company/components/audit-entries';
import { AuditFilters } from '@/modules/company/components/audit-filters';
import { activityHref, AuditPagination } from '@/modules/company/components/audit-pagination';

/**
 * Activity log — what has been done to this account, and by whom.
 *
 * `audit_logs` has been recording company actions since migration 0002 and,
 * until now, only `/super-admin/audit-logs` ever read it. So the questions the
 * table exists to answer — who deleted that guided chat, who removed Sara from
 * the team, who moved us onto the bigger plan — were answerable by the platform
 * operator and by nobody at the business whose account it is.
 *
 * WHO CAN READ IT
 * ---------------
 * Company admins only. The log carries plan changes, credit top-ups and team
 * removals; an agent's own inbox actions appear in it, but the account's
 * commercial history is not an agent's to read. `requireRole` sends anyone else
 * to their own home rather than erroring.
 *
 * NOT PLAN-GATED, DELIBERATELY
 * ----------------------------
 * `src/lib/entitlements.ts` has no feature key that covers this, and inventing
 * one would put a record of what a platform operator did to a customer's
 * account behind a price. Seeing your own history is not an upsell.
 */

export const dynamic = 'force-dynamic';

const BASE_PATH = '/company/activity';

export default async function CompanyActivityPage({
  searchParams,
}: {
  searchParams?: { actor?: string; type?: string; from?: string; to?: string; page?: string };
}) {
  await requireRole([ROLES.COMPANY_ADMIN]);

  const filters = normaliseActivityFilters(searchParams ?? {});
  const { results, actors, actions, timezone } = await getCompanyActivity(filters);
  const isFiltered = Boolean(filters.actor || filters.type || filters.from || filters.to);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Entries arrive from outside this tab — a teammate acting in their own
          session, or the support team acting on the account — so a log left
          open goes stale with nothing to say so. */}
      <RefreshOnFocus />
      <PageHeader
        title="Activity log"
        description="Every change made to this account — by your team, and by our support team."
      />

      <Card>
        {/* `space-y-4`, not the header's default 1.5: the filter bar is a block
            of controls under the title, not a caption line beside it. */}
        <CardHeader className="space-y-4">
          <div>
            <CardTitle>
              What has happened
              <span className="ms-2 text-sm font-normal text-muted-foreground tabular-nums">
                {results.total}
              </span>
            </CardTitle>
            <CardDescription>Newest first. Point at a time to see it exactly.</CardDescription>
          </div>
          <AuditFilters
            basePath={BASE_PATH}
            filters={filters}
            actors={actors}
            actions={actions}
            timezone={timezone}
          />
        </CardHeader>

        <CardContent className="p-0">
          {results.entries.length === 0 ? (
            /* A `?page=` past the end is empty but the log is not, and telling
               someone who has 400 entries that nothing is recorded yet would be
               a plain lie. Say which of the three it is. */
            results.total > 0 ? (
              <EmptyState
                title="That page is past the end"
                body={`There ${results.pageCount === 1 ? 'is' : 'are'} ${results.pageCount} ${
                  results.pageCount === 1 ? 'page' : 'pages'
                } of activity to read.`}
                action={
                  <Button asChild size="sm" variant="outline">
                    <Link href={activityHref(BASE_PATH, filters, 1)}>Back to the newest</Link>
                  </Button>
                }
              />
            ) : isFiltered ? (
              <EmptyState
                title="Nothing matches that"
                body="Try a wider set of dates, or ask for everyone rather than one person."
                action={
                  <Button asChild size="sm" variant="outline">
                    <Link href={BASE_PATH}>Show everything</Link>
                  </Button>
                }
              />
            ) : (
              <EmptyState
                title="Nothing recorded yet"
                body="Inviting someone to the team, changing your plan, or anyone from our support team touching your account will all be listed here."
              />
            )
          ) : (
            <>
              <AuditEntries entries={results.entries} timezone={timezone} />
              <AuditPagination basePath={BASE_PATH} filters={filters} results={results} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
