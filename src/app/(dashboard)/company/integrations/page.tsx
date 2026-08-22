import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { InfoBanner } from '@/components/info-banner';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile } from '@/components/ui/stat-tile';
import { formatDate, formatNumber } from '@/lib/format';
import {
  catalogCounts,
  listIntegrations,
  listSyncJobs,
} from '@/modules/company/integrations-data';
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
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={<>Integrations &amp; Sync</>}
        description="Connect WordPress/WooCommerce, Shopify, Custom API, Google Calendar, or CSV so the assistant can answer from current business data."
      />

      <InfoBanner>
        Connected integrations are synced automatically every hour via the cron endpoint. Use
        “Resync” below to pull updates on demand.
      </InfoBanner>

      <Card>
        <CardHeader>
          <CardTitle>How custom systems connect</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm text-muted-foreground md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-md border p-3">
            <p className="font-medium text-foreground">WordPress/WooCommerce</p>
            <p className="mt-1">For WordPress shops using WooCommerce. Sync products, prices, stock, customers, and orders.</p>
          </div>
          <div className="rounded-md border p-3">
            <p className="font-medium text-foreground">Shopify</p>
            <p className="mt-1">Sync Shopify products, variants, inventory, customers, orders, and order items.</p>
          </div>
          <div className="rounded-md border p-3">
            <p className="font-medium text-foreground">Custom REST API</p>
            <p className="mt-1">For .NET, Node, PHP, JavaScript, mobile apps, and ERPs. Follow the Custom API schema.</p>
          </div>
          <div className="rounded-md border p-3">
            <p className="font-medium text-foreground">CSV fallback</p>
            <p className="mt-1">For customers without developers. Upload products, inventory, orders, customers, or menu data.</p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <StatTile key={s.label} label={s.label} value={formatNumber(s.value)} />
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Import from CSV</CardTitle>
        </CardHeader>
        <CardContent>
          <CsvImportForm />
        </CardContent>
      </Card>

      <Card id="connect-integration">
        <CardHeader>
          <CardTitle>Connect an integration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button asChild variant="outline">
            <a href="/api/integrations/google/start">Connect Google Calendar</a>
          </Button>
          <Button asChild variant="outline">
            <a href="/api/integrations/custom/schema" target="_blank">Custom API schema</a>
          </Button>
          <ConnectIntegrationForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Connected integrations</CardTitle>
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
                  <TableHead>Provider</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last sync</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {integrations.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="font-medium">{i.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{i.provider.replace(/_/g, ' ')}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(i.status)}>{i.status}</Badge>
                    </TableCell>
                    <TableCell>{formatDate(i.lastSyncAt)}</TableCell>
                    <TableCell className="text-end">
                      <div className="flex justify-end gap-2">
                        <form action={resyncAction}>
                          <input type="hidden" name="accountId" value={i.id} />
                          <Button type="submit" variant="outline" size="sm">
                            Resync
                          </Button>
                        </form>
                        <form action={disconnectAction}>
                          <input type="hidden" name="accountId" value={i.id} />
                          <ConfirmSubmit label="Disconnect" confirmLabel="Yes, disconnect" question="Synced data stops updating." />
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
          <CardTitle>Recent sync jobs</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {jobs.length === 0 ? (
            // Module 2 — a log, not a task: explain what fills it, no button.
            <EmptyState
              title="No sync jobs yet."
              body="Each hourly sync, on-demand resync, and CSV import is logged here so you can see what was pulled in and what failed."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Records</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((j) => (
                  <TableRow key={j.id}>
                    <TableCell>
                      <Badge variant={jobVariant(j.status)}>{j.status}</Badge>
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
  );
}
