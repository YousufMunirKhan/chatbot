import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form-field';
import { PageHeader } from '@/components/ui/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatAbsoluteTime, formatRelativeTime } from '@/lib/relative-time';
import { CUSTOMER_RECORD_LINKS, getCustomersPage } from '@/modules/company/customers-data';
import { Pagination } from '@/modules/company/components/list-controls';
import { RefreshOnFocus } from '@/components/refresh-on-focus';

/**
 * Customers — now a list of people rather than a list of rows.
 *
 * WHAT CHANGED AND WHY
 * This page used to show three tabs over three tables: enquiries, booking
 * requests and orders. Every one of those is an EVENT, and the same human who
 * emailed in March, messaged WhatsApp in June and ordered last week appeared in
 * all three as three unrelated strangers. A page called Customers that cannot
 * tell you whether two rows are the same customer is not a customer list.
 *
 * So the rows are people now (migration 0076 built them, and keeps building
 * them as new enquiries arrive), and each one opens a page holding everything
 * that person has ever sent, asked for and bought.
 *
 * The event lists have not gone anywhere — they are the three links under the
 * search box, still carrying their real totals. And the enquiries that left no
 * email and no phone are called out there by name: nobody could be built from
 * them, and quietly dropping them would make the business look smaller than it
 * is.
 *
 * The performance rebuild this page had is kept and extended: the counts are
 * one RPC instead of four head-only queries, and the list fetches exactly the
 * page on screen. Two round trips, where the tabs cost five.
 */

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;
const BASE_PATH = '/company/customers';
const SEARCH_ID = 'customers-search';

function pageNumber(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '1', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/**
 * How to reach someone, in one cell.
 *
 * A person can hold several addresses once two records have been merged, and a
 * table cell is not the place for all of them — the first of each, plus a count
 * of the rest, says everything the reader needs before clicking through.
 */
function Reachable({ emails, phones }: { emails: string[]; phones: string[] }) {
  const extra = Math.max(0, emails.length - 1) + Math.max(0, phones.length - 1);
  if (!emails.length && !phones.length) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="min-w-0 space-y-0.5">
      {emails[0] ? <p className="truncate">{emails[0]}</p> : null}
      {phones[0] ? <p className="truncate text-muted-foreground">{phones[0]}</p> : null}
      {extra > 0 ? (
        <p className="text-xs text-muted-foreground">
          +{extra} more {extra === 1 ? 'address' : 'addresses'}
        </p>
      ) : null}
    </div>
  );
}

export default async function CustomersWorkspacePage({
  searchParams,
}: {
  searchParams?: { q?: string; page?: string };
}) {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);

  const search = searchParams?.q?.trim() || undefined;
  const page = pageNumber(searchParams?.page);
  const { counts, people } = await getCustomersPage({ page, pageSize: PAGE_SIZE, search });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <RefreshOnFocus />
      <PageHeader
        title="Customers"
        description="Every person who has been in touch, however they got in touch. One record each."
      />

      {/* The event lists, with their real totals. These are where the work
          happens; this page is where you find out who it was for. */}
      <nav aria-label="Records these people appear in" className="flex flex-wrap gap-2">
        {CUSTOMER_RECORD_LINKS.map(({ key, label, href }) => (
          <Link
            key={key}
            href={href}
            className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground hover:bg-muted/50"
          >
            <span>{label}</span>
            <span className="rounded-full bg-background px-2 py-0.5 text-xs tabular-nums">
              {counts[key]}
            </span>
          </Link>
        ))}
      </nav>

      {counts.unidentifiedEnquiries > 0 ? (
        <p className="text-sm text-muted-foreground">
          {counts.unidentifiedEnquiries === 1
            ? 'One enquiry left no email and no phone, so there is nobody to file it under. '
            : `${counts.unidentifiedEnquiries} enquiries left no email and no phone, so there is nobody to file them under. `}
          <Link href="/company/leads" className="underline underline-offset-4">
            They are still in your enquiries.
          </Link>
        </p>
      ) : null}

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>
              {search ? `People matching “${search}”` : 'People'}
              <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
                {people.total}
              </span>
            </CardTitle>
            <CardDescription>Most recently heard from first.</CardDescription>
          </div>
          {/* A plain GET form: no JavaScript, bookmarkable, and it survives a
              back button. Same shape as the filter bars on the other lists. */}
          <form method="get" action={BASE_PATH} className="flex flex-wrap items-end gap-2">
            <FormField label="Search" htmlFor={SEARCH_ID}>
              <input
                id={SEARCH_ID}
                type="search"
                name="q"
                defaultValue={search ?? ''}
                placeholder="Name, email or phone"
                className="flex h-9 w-56 rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </FormField>
            <Button type="submit" variant="outline" size="sm">
              Search
            </Button>
            {search ? (
              <Button asChild variant="ghost" size="sm">
                <Link href={BASE_PATH}>Clear</Link>
              </Button>
            ) : null}
          </form>
        </CardHeader>

        <CardContent className="p-0">
          {people.rows.length === 0 ? (
            search ? (
              <EmptyState
                title="Nobody matches that"
                body="Search by any part of a name, an email address or a phone number."
                action={
                  <Button asChild size="sm" variant="outline">
                    <Link href={BASE_PATH}>Show everyone</Link>
                  </Button>
                }
              />
            ) : (
              <EmptyState
                title="No customers yet"
                body="A person appears here the moment anyone leaves an email address or a phone number — in the chat, on a booking, or through your shop."
                action={
                  <Button asChild size="sm">
                    <Link href="/company/widget">Put the chat on your website</Link>
                  </Button>
                }
              />
            )
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>How to reach them</TableHead>
                    <TableHead>Tags</TableHead>
                    <TableHead>Last heard from</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {people.rows.map((person) => (
                    <TableRow key={person.id}>
                      <TableCell className="font-medium">
                        {/* The whole row is about this person, so the name is
                            the link — a separate "View" column would be a
                            second click target for the same thing. */}
                        <Link
                          href={`${BASE_PATH}/${person.id}`}
                          className="underline-offset-4 hover:underline"
                        >
                          {person.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Reachable emails={person.emails} phones={person.phones} />
                      </TableCell>
                      <TableCell>
                        {person.tags.length ? (
                          <div className="flex flex-wrap gap-1">
                            {person.tags.map((tag) => (
                              <Badge key={tag} variant="secondary">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell
                        className="text-muted-foreground"
                        title={formatAbsoluteTime(person.lastSeenAt)}
                      >
                        {formatRelativeTime(person.lastSeenAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination
                basePath={BASE_PATH}
                page={people.page}
                pageCount={people.pageCount}
                total={people.total}
                pageSize={people.pageSize}
                search={search}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
