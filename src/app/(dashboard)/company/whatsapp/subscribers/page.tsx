import { requireRole } from '@/lib/auth';
import { CHANNEL_LABELS, ROLES, humanizeToken, labelFor } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
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

async function setSubscription(formData: FormData) {
  'use server';
  await setSubscriptionAction(formData);
}

export default async function WhatsAppSubscribersPage({
  searchParams,
}: {
  searchParams?: { q?: string };
}) {
  await requireRole([ROLES.COMPANY_ADMIN]);
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
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>
              {subscribers.length} contact{subscribers.length === 1 ? '' : 's'}
            </CardTitle>
            <CardDescription>{optedOut} opted out.</CardDescription>
          </div>
          {/* GET form: the search term lives in the URL, so the page stays a
              server component and the result is shareable/bookmarkable. */}
          <form method="get" className="flex items-end gap-2">
            <FormField label="Find a contact" htmlFor="q">
              <Input
                name="q"
                defaultValue={search}
                placeholder="07700 900123, or name@example.com"
                className="h-9 w-56"
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
                  <TableHead />
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
                        <Button type="submit" size="sm" variant="outline">
                          {s.optedIn ? 'Opt out' : 'Opt back in'}
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
