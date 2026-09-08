import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
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
 * How to reach someone, in one row.
 *
 * A person can hold several addresses once two records have been merged, and a
 * list row is not the place for all of them — the first of each, plus a count
 * of the rest, says everything the reader needs before opening the record.
 *
 * With nothing on file it says so in words. It used to render a bare em dash,
 * which reads as a value that failed to load rather than as a person who never
 * left an address.
 */
function Reachable({ emails, phones }: { emails: string[]; phones: string[] }) {
  const extra = Math.max(0, emails.length - 1) + Math.max(0, phones.length - 1);
  if (!emails.length && !phones.length) {
    return <p className="text-muted-foreground">No email or phone on file</p>;
  }
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
            {/* `bg-muted`, not `bg-background`: the pill sat on the page's own
                background, so the count had no shape around it at all — and on
                hover the tile went muted and the pill turned into a pale blob. */}
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">
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
        {/* `space-y-0`: `CardHeader`'s own rhythm is `space-y-1.5` on a
            column, and leaving it on while forcing `flex-row` put a 6px top
            margin on the search form, so the title and the box it sits beside
            were never on the same baseline. */}
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div className="min-w-0">
            <CardTitle>
              {search ? `People matching “${search}”` : 'People'}
              {/* `ms-`, not `ml-`: the dashboard shell sets dir="rtl" for
                  Arabic companies and physical utilities do not flip. */}
              <span className="ms-2 text-sm font-normal text-muted-foreground tabular-nums">
                {people.total}
              </span>
            </CardTitle>
            <CardDescription>Most recently heard from first.</CardDescription>
          </div>
          {/* A plain GET form: no JavaScript, bookmarkable, and it survives a
              back button. Same shape as the filter bars on the other lists.
              Full width on a phone, where a 224px box beside two buttons wrapped
              into a ragged three-line block. */}
          <form
            method="get"
            action={BASE_PATH}
            className="flex w-full flex-wrap items-end gap-2 sm:w-auto"
          >
            <FormField label="Search" htmlFor={SEARCH_ID} className="min-w-0 flex-1 sm:flex-none">
              {/* The `Input` primitive rather than a hand-copied class string:
                  one radius, one focus ring, and a browser autofill paints the
                  control the product actually styles. `size="sm"` is the 36px
                  toolbar height, so the box, the Search button and the Clear
                  link finally sit on one line. */}
              <Input
                type="search"
                name="q"
                size="sm"
                defaultValue={search ?? ''}
                placeholder="Name, email or phone"
                className="w-full sm:w-56"
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
              {/*
                A list of rows, not a four-column table.

                An email address is long, so the "How to reach them" column
                stretched the table past 375px and a phone reader got a
                sideways scrollbar over the two columns that decide whether to
                open the record. This is the inbox's row instead — one `<Link>`
                wrapping the whole row, so it is one tab stop and a whole-row
                tap target, which is also what the old comment here wanted when
                it made the name the only link rather than adding a "View"
                column. The four headings are gone because each value says what
                it is: an address is an address, a badge is a tag you added, and
                the card already says the list is newest first.
              */}
              <ul className="divide-y">
                {people.rows.map((person) => (
                  <li key={person.id}>
                    <Link
                      href={`${BASE_PATH}/${person.id}`}
                      className="block px-4 py-3 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{person.name}</p>
                          <div className="mt-0.5 text-sm">
                            <Reachable emails={person.emails} phones={person.phones} />
                          </div>
                          {person.tags.length ? (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {person.tags.map((tag) => (
                                <Badge key={tag} variant="secondary">
                                  {tag}
                                </Badge>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <time
                          dateTime={person.lastSeenAt}
                          title={formatAbsoluteTime(person.lastSeenAt)}
                          className="shrink-0 text-xs text-muted-foreground"
                        >
                          {formatRelativeTime(person.lastSeenAt)}
                        </time>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
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
