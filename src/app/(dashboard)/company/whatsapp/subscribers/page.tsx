import { requireRole } from '@/lib/auth';
import { CHANNEL_LABELS, ROLES, humanizeToken, labelFor } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { UpgradeNotice } from '@/components/ui/upgrade-notice';
import { companyHasFeature, requireCompanyFeature } from '@/lib/entitlements';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { listSubscribers } from '@/modules/company/whatsapp-data';
import { setSubscriptionAction } from '@/modules/company/whatsapp-actions';
import { SubscriberForm } from '@/modules/company/components/whatsapp-settings-forms';

// The gate below decides what this page draws; this decides what a post can do.
// A form that is never rendered is still reachable with a crafted request.
async function setSubscription(formData: FormData) {
  'use server';
  await requireCompanyFeature('whatsapp');
  await setSubscriptionAction(formData);
}

export default async function WhatsAppSubscribersPage({
  searchParams,
}: {
  searchParams?: { q?: string };
}) {
  await requireRole([ROLES.COMPANY_ADMIN]);
  // Consent belongs to the WhatsApp package, so it is gated with it. No back
  // link here: /company/whatsapp is gated on the same feature and would only
  // send the reader to a second copy of this page.
  if (!(await companyHasFeature('whatsapp'))) {
    return <UpgradeNotice feature="whatsapp" title="Who you may message" />;
  }

  const search = (searchParams?.q ?? '').trim();
  const subscribers = await listSubscribers(search);
  const optedOut = subscribers.filter((s) => !s.optedIn).length;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        backTo={{ href: '/company/whatsapp', label: 'WhatsApp Business' }}
        title="Who you may message"
        description="Who has agreed to hear from you, and who has replied STOP. Anyone who has opted out is skipped automatically — WhatsApp requires that, and ignoring it is how numbers get banned."
      />

      <Card>
        <CardHeader>
          <CardTitle>Add or update a contact</CardTitle>
          <CardDescription>
            Use this to import consent collected elsewhere, or to opt someone out on request.
            Inbound STOP / ايقاف messages are recorded automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SubscriberForm />
        </CardContent>
      </Card>

      <Card>
        {/* `CardHeader` is `flex flex-col space-y-1.5`. Overriding only
            `flex-row` leaves the `space-y-1.5` behind, which in a row becomes a
            6px margin-TOP on the search form — so it sat 6px below the centre
            line `items-center` had just aligned it to. `space-y-0` removes it. */}
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div className="min-w-0">
            <CardTitle>
              {subscribers.length} contact{subscribers.length === 1 ? '' : 's'}
            </CardTitle>
            <CardDescription>
              {optedOut === 0
                ? 'Nobody has opted out.'
                : `${optedOut} of them ${optedOut === 1 ? 'has' : 'have'} opted out and will be skipped.`}
            </CardDescription>
          </div>
          {/* GET form: the search term lives in the URL, so the page stays a
              server component and the result is shareable/bookmarkable.

              `w-56` was a fixed 224px. At 375px this card has about 295px of
              content, and 224px + gap + a "Search" button is wider than that —
              the button was pushed off the card's trailing edge. `min-w-0
              flex-1` with a `sm:w-56` ceiling lets the box give up width when
              there is none and hold its comfortable size when there is.
              `size="sm"` rather than a hand-written `h-9`: that is the same
              36px, taken from the scale, so it cannot drift away from the
              button beside it. */}
          <form method="get" className="flex min-w-0 flex-1 items-end gap-2 sm:flex-none">
            <FormField label="Find a contact" htmlFor="q" className="min-w-0 flex-1 sm:w-56">
              <Input
                size="sm"
                name="q"
                type="search"
                defaultValue={search}
                placeholder="07700 900123, or name@example.com"
              />
            </FormField>
            <Button type="submit" size="sm" variant="outline">
              Search
            </Button>
          </form>
        </CardHeader>
        <CardContent className="p-0">
          {subscribers.length === 0 ? (
            <EmptyState
              title={search ? 'No contacts match that search' : 'No subscribers yet'}
              body={
                search
                  ? 'Try part of the number, without spaces or the country code separator.'
                  : 'Contacts appear here the first time they opt in or out — through the widget, an import, or a STOP keyword on WhatsApp.'
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contact</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Updated</TableHead>
                  {/* A self-closing `<TableHead />` is a column with no name,
                      and a screen reader reads a cell's column header before
                      the cell — so every button in this column was announced as
                      "blank, Opt out". */}
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subscribers.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.contactIdentifier}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {labelFor(CHANNEL_LABELS, s.channel)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={s.optedIn ? 'success' : 'destructive'}>
                        {s.optedIn ? 'Opted in' : 'Opted out'}
                      </Badge>
                    </TableCell>
                    {/* No label map covers consent sources yet — they are written
                        by whichever route recorded the opt-in (`widget`,
                        `import`, `stop_keyword`), so `humanizeToken` is the
                        honest floor until one exists. */}
                    <TableCell className="text-muted-foreground">
                      {humanizeToken(s.source)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(s.updatedAt)}
                    </TableCell>
                    {/* Logical, not physical: this column has to sit on the
                        trailing edge in Arabic too, where that is the left. */}
                    <TableCell className="text-end">
                      <form action={setSubscription}>
                        <input type="hidden" name="id" value={s.id} />
                        <input type="hidden" name="optedIn" value={(!s.optedIn).toString()} />
                        {/* A page of forty contacts otherwise offers a
                            screen-reader user forty buttons all called "Opt
                            out". The contact names its own row. */}
                        <Button type="submit" size="sm" variant="outline">
                          {s.optedIn ? 'Opt out' : 'Opt back in'}
                          <span className="sr-only">: {s.contactIdentifier}</span>
                        </Button>
                      </form>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
