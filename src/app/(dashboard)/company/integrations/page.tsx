import { requireRole } from '@/lib/auth';
import {
  ROLES,
  CONNECTION_STATUS_LABELS,
  DELIVERY_STATUS_LABELS,
  PROVIDER_LABELS,
  labelFor,
} from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { InfoBanner } from '@/components/info-banner';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile } from '@/components/ui/stat-tile';
import { formatDate, formatNumber } from '@/lib/format';
import { catalogCounts, listIntegrations, listSyncJobs } from '@/modules/company/integrations-data';
import { disconnectAction, resyncAction } from '@/modules/company/integrations-actions';
import { CsvImportForm } from '@/modules/company/components/csv-import-form';
import { ConnectIntegrationForm } from '@/modules/company/components/connect-integration-form';
import { ConfirmSubmit } from '@/components/confirm-submit';

function statusVariant(status: string): 'success' | 'destructive' | 'secondary' {
  if (status === 'connected') return 'success';
  if (status === 'error') return 'destructive';
  return 'secondary';
}

function jobVariant(status: string): 'success' | 'destructive' | 'warning' | 'secondary' {
  if (status === 'success' || status === 'completed') return 'success';
  if (status === 'error' || status === 'failed') return 'destructive';
  if (status === 'running' || status === 'pending') return 'warning';
  return 'secondary';
}

export default async function CompanyIntegrationsPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const [counts, integrations, jobs] = await Promise.all([
    catalogCounts(),
    listIntegrations(),
    listSyncJobs(),
  ]);

  const stats: { label: string; value: number }[] = [
    { label: 'Products', value: counts.products },
    { label: 'Orders', value: counts.orders },
    { label: 'Customers', value: counts.customers },
    { label: 'Menu items', value: counts.menuItems },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Connect your shop"
        description="Link Shopify, WooCommerce, WordPress, Google Calendar, your own system, or a spreadsheet, and the assistant answers from your real prices, stock and orders instead of a copy you have to keep updating."
      />

      <InfoBanner>
        Anything you connect refreshes by itself once an hour. If you have just changed a price and
        want it now, press “Refresh now” next to it.
      </InfoBanner>

      <Card>
        <CardHeader>
          <CardTitle>How custom systems connect</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm text-muted-foreground md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-md border p-3">
            <p className="font-medium text-foreground">WordPress/WooCommerce</p>
            <p className="mt-1">
              For WordPress shops using WooCommerce. Sync products, prices, stock, customers, and
              orders.
            </p>
          </div>
          <div className="rounded-md border p-3">
            <p className="font-medium text-foreground">Shopify</p>
            <p className="mt-1">
              Sync Shopify products, variants, inventory, customers, orders, and order items.
            </p>
          </div>
          <div className="rounded-md border p-3">
            <p className="font-medium text-foreground">Custom REST API</p>
            <p className="mt-1">
              For .NET, Node, PHP, JavaScript, mobile apps, and ERPs. Follow the Custom API schema.
            </p>
          </div>
          <div className="rounded-md border p-3">
            <p className="font-medium text-foreground">CSV fallback</p>
            <p className="mt-1">
              For customers without developers. Upload products, inventory, orders, customers, or
              menu data.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <StatTile key={s.label} label={s.label} value={formatNumber(s.value)} />
        ))}
      </div>

      {/* Desktop: what is already connected and how it last refreshed on
          the left; the two ways to add something on the right. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>What you have connected</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {integrations.length === 0 ? (
                // Module 1 — the connect form is on this page, so link straight to it.
                <EmptyState
                  title="Nothing connected yet."
                  body="Link your store, calendar, or custom API and the assistant answers from live prices, stock, and orders instead of a copy you have to keep updating."
                  action={
                    <Button asChild size="sm">
                      <a href="#connect-integration">Connect an integration</a>
                    </Button>
                  }
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>App</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Last refreshed</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {integrations.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell className="font-medium">{i.name}</TableCell>
                        <TableCell>
                          {/* Was `provider.replace(/_/g, ' ')`, which turned an
                            adapter id into "woocommerce" and "custom api" rather
                            than into the product's actual name. */}
                          <Badge variant="outline">{labelFor(PROVIDER_LABELS, i.provider)}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(i.status)}>
                            {labelFor(CONNECTION_STATUS_LABELS, i.status)}
                          </Badge>
                        </TableCell>
                        <TableCell>{formatDate(i.lastSyncAt)}</TableCell>
                        <TableCell className="text-end">
                          <div className="flex justify-end gap-2">
                            <form action={resyncAction}>
                              <input type="hidden" name="accountId" value={i.id} />
                              <Button type="submit" variant="outline" size="sm">
                                Refresh now
                              </Button>
                            </form>
                            <form action={disconnectAction}>
                              <input type="hidden" name="accountId" value={i.id} />
                              <ConfirmSubmit
                                label="Disconnect"
                                confirmLabel="Yes, disconnect"
                                question="Your prices, stock and orders stop updating, and the assistant goes back to whatever you have typed in yourself."
                              />
                            </form>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent refreshes</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Every hourly refresh, manual refresh and spreadsheet upload, newest first — so you
                can see what came in and what went wrong.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              {jobs.length === 0 ? (
                // Module 2 — a log, not a task: explain what fills it, no button.
                <EmptyState
                  title="Nothing has refreshed yet"
                  body="Once you connect a shop or upload a spreadsheet, every refresh is listed here with how many records came in."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead>Records brought in</TableHead>
                      <TableHead>What went wrong</TableHead>
                      <TableHead>When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobs.map((j) => (
                      <TableRow key={j.id}>
                        <TableCell>
                          <Badge variant={jobVariant(j.status)}>
                            {labelFor(DELIVERY_STATUS_LABELS, j.status)}
                          </Badge>
                        </TableCell>
                        <TableCell>{formatNumber(j.recordsProcessed)}</TableCell>
                        <TableCell className="max-w-xs truncate text-muted-foreground">
                          {j.errorMessage ?? '—'}
                        </TableCell>
                        <TableCell>{formatDate(j.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sticky on desktop: you fill this in while reading the list
            beside it, so it must not scroll away with that list. */}
        <div className="space-y-6 lg:sticky lg:top-6 lg:self-start">
          <Card id="connect-integration">
            <CardHeader>
              <CardTitle>Connect an integration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button asChild variant="outline">
                <a href="/api/integrations/google/start">Connect Google Calendar</a>
              </Button>
              <Button asChild variant="outline">
                <a href="/api/integrations/custom/schema" target="_blank">
                  Custom API schema
                </a>
              </Button>
              <ConnectIntegrationForm />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Import from CSV</CardTitle>
            </CardHeader>
            <CardContent>
              <CsvImportForm />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
