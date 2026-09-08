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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { Alert } from '@/components/ui/alert';
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

  // Decides the shape of the page below, not just what one card says.
  const hasIntegrations = integrations.length > 0;

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

      {/* `InfoBanner` is a thin wrapper that always renders `tone="warning"`.
          This sentence is reassurance — your prices keep themselves up to date
          — and it was being drawn in amber, the product's colour for "something
          needs your attention". Amber above a list of healthy connections is a
          false alarm at the top of every visit. */}
      <Alert tone="info">
        Anything you connect refreshes by itself once an hour. If you have just changed a price and
        want it now, press “Refresh now” next to it.
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>How custom systems connect</CardTitle>
        </CardHeader>
        {/* Four explanatory tiles. `xl:grid-cols-4` is 1280px+; below that they
            were two columns of ~530px and then, at exactly 1280, four of 250px
            holding three-line paragraphs. A floor gives the same four-across on
            a wide screen and steps down cleanly rather than at one breakpoint. */}
        <CardContent className="grid gap-3 text-sm text-muted-foreground [grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))]">
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

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(10rem,1fr))]">
        {stats.map((s) => (
          <StatTile key={s.label} label={s.label} value={formatNumber(s.value)} />
        ))}
      </div>

      {/*
        WITH SOMETHING CONNECTED: what is already connected and how it last
        refreshed on the left, the two ways to add something on the right,
        sticky — you fill the form in while reading the list beside it.

        WITH NOTHING CONNECTED: no split. The 1.6fr column — nearly two thirds
        of the page — held an `EmptyState` whose button read "Connect an
        integration" and scrolled you to a form ALREADY ON SCREEN beside it,
        while that form was squeezed into the remaining ~400px third. The two
        ways to add something ARE the task on a fresh account, so they take the
        width, and the list of what you have moves below them where it belongs
        until there is something in it. Same reasoning `/company/flows` was
        rebuilt on.

        `[&>*]:min-w-0` on the split: a grid item's default `min-width: auto`
        is "as wide as my longest unbreakable child", and the left column holds
        tables of URLs and error messages.
      */}
      {/*
        WITH SOMETHING CONNECTED: what is already connected and how it last
        refreshed on the left, the two ways to add something on the right,
        sticky — you fill the form in while reading the list beside it.

        WITH NOTHING CONNECTED: no split, and the order flips. The 1.6fr column
        — nearly two thirds of the page — held an `EmptyState` whose button read
        "Connect an integration" and scrolled you to a form ALREADY ON SCREEN
        beside it, while that form was squeezed into the remaining ~400px third.
        The two ways to add something ARE the task on a fresh account, so they
        take the width and come first. Same reasoning `/company/flows` was
        rebuilt on.

        The two branches SWAP THE MARKUP rather than reversing it with
        `flex-col-reverse` or `order-*`. Either of those leaves the DOM saying
        one order and the screen showing another, which is WCAG 1.3.2 — a
        screen-reader user would have been read "Nothing connected yet. Use the
        form above" before reaching a form that is, for them, below.

        `[&>*]:min-w-0` on the split: a grid item's default `min-width: auto` is
        "as wide as my longest unbreakable child", and the left column holds
        tables of webhook URLs and provider error messages.
      */}
      {hasIntegrations ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>What you have connected</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {integrations.length === 0 ? (
                // No button. It used to carry one reading "Connect an
                // integration" that jumped to `#connect-integration` — a form
                // that, on the only screen where this empty state renders, is
                // now directly above and already visible. A call to action
                // pointing at something the reader can already see is noise.
                <EmptyState
                  title="Nothing connected yet."
                  body="Use the form above to link your store, calendar, or custom API, and the assistant answers from live prices, stock and orders instead of a copy you have to keep updating."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>App</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Last refreshed</TableHead>
                      {/* An empty `<TableHead>` is a column with no name. A
                          screen reader announcing a cell reads its column
                          header first, so every button in this column was
                          announced as "blank, Refresh now". Named for assistive
                          tech only — a visible heading over two buttons is
                          noise. */}
                      <TableHead>
                        <span className="sr-only">Actions</span>
                      </TableHead>
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
              {/* `<p className="mt-1 text-sm text-muted-foreground">` is
                  `CardDescription` written out by hand — same result today, one
                  more place for the two to drift tomorrow, and `CardHeader`
                  already supplies the `space-y-1.5` that `mt-1` was duplicating
                  (so the gap here was 6px + 4px against 6px on every other card
                  on the page). */}
              <CardDescription>
                Every hourly refresh, manual refresh and spreadsheet upload, newest first — so you
                can see what came in and what went wrong.
              </CardDescription>
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
        {/* Sticky only when there is a list beside it to stay level with.
            On a fresh account this is the whole page, and a sticky element
            that is taller than the viewport just stops scrolling. The two
            cards go side by side at full width via a floor, not a breakpoint. */}
        <div
          className={
            hasIntegrations
              ? 'space-y-6 lg:sticky lg:top-6 lg:self-start'
              : 'grid gap-6 [grid-template-columns:repeat(auto-fit,minmax(22rem,1fr))] [&>*]:min-w-0'
          }
        >
          <Card id="connect-integration">
            <CardHeader>
              <CardTitle>Connect an integration</CardTitle>
              <CardDescription>
                Google Calendar signs you in and needs nothing else. Everything else asks for an
                address and a key from the shop you are linking.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/*
                `space-y-4` on a stack of `Button`s does not do what it looks
                like it does. `Button` is `inline-flex`, so two of them in a
                block container flow onto the SAME line while there is room and
                `space-y` puts a margin-top on the second one — which then sits
                16px lower than the first on that shared line. In this ~400px
                sidebar they usually wrapped, so the bug showed as two buttons
                on two lines with a stray vertical offset between them, and at
                other widths as one ragged row. A flex container with `gap` is
                the honest version, and `flex-wrap` lets them share a line
                properly when the card is wide.
              */}
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline">
                  <a href="/api/integrations/google/start">Connect Google Calendar</a>
                </Button>
                <Button asChild variant="outline">
                  {/* `rel` is not optional on a `target="_blank"` link — without
                      `noopener` the page it opens gets a handle on this one via
                      `window.opener`. And a link that silently replaces the
                      reader's context has to say so; the note is `sr-only`
                      because sighted users get the browser's own new-tab cue. */}
                  <a
                    href="/api/integrations/custom/schema"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Custom API schema
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </Button>
              </div>
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
      ) : (
        <div className="space-y-6">
        {/* Sticky only when there is a list beside it to stay level with.
            On a fresh account this is the whole page, and a sticky element
            that is taller than the viewport just stops scrolling. The two
            cards go side by side at full width via a floor, not a breakpoint. */}
        <div
          className={
            hasIntegrations
              ? 'space-y-6 lg:sticky lg:top-6 lg:self-start'
              : 'grid gap-6 [grid-template-columns:repeat(auto-fit,minmax(22rem,1fr))] [&>*]:min-w-0'
          }
        >
          <Card id="connect-integration">
            <CardHeader>
              <CardTitle>Connect an integration</CardTitle>
              <CardDescription>
                Google Calendar signs you in and needs nothing else. Everything else asks for an
                address and a key from the shop you are linking.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/*
                `space-y-4` on a stack of `Button`s does not do what it looks
                like it does. `Button` is `inline-flex`, so two of them in a
                block container flow onto the SAME line while there is room and
                `space-y` puts a margin-top on the second one — which then sits
                16px lower than the first on that shared line. In this ~400px
                sidebar they usually wrapped, so the bug showed as two buttons
                on two lines with a stray vertical offset between them, and at
                other widths as one ragged row. A flex container with `gap` is
                the honest version, and `flex-wrap` lets them share a line
                properly when the card is wide.
              */}
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline">
                  <a href="/api/integrations/google/start">Connect Google Calendar</a>
                </Button>
                <Button asChild variant="outline">
                  {/* `rel` is not optional on a `target="_blank"` link — without
                      `noopener` the page it opens gets a handle on this one via
                      `window.opener`. And a link that silently replaces the
                      reader's context has to say so; the note is `sr-only`
                      because sighted users get the browser's own new-tab cue. */}
                  <a
                    href="/api/integrations/custom/schema"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Custom API schema
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </Button>
              </div>
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
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>What you have connected</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {integrations.length === 0 ? (
                // No button. It used to carry one reading "Connect an
                // integration" that jumped to `#connect-integration` — a form
                // that, on the only screen where this empty state renders, is
                // now directly above and already visible. A call to action
                // pointing at something the reader can already see is noise.
                <EmptyState
                  title="Nothing connected yet."
                  body="Use the form above to link your store, calendar, or custom API, and the assistant answers from live prices, stock and orders instead of a copy you have to keep updating."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>App</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Last refreshed</TableHead>
                      {/* An empty `<TableHead>` is a column with no name. A
                          screen reader announcing a cell reads its column
                          header first, so every button in this column was
                          announced as "blank, Refresh now". Named for assistive
                          tech only — a visible heading over two buttons is
                          noise. */}
                      <TableHead>
                        <span className="sr-only">Actions</span>
                      </TableHead>
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
              {/* `<p className="mt-1 text-sm text-muted-foreground">` is
                  `CardDescription` written out by hand — same result today, one
                  more place for the two to drift tomorrow, and `CardHeader`
                  already supplies the `space-y-1.5` that `mt-1` was duplicating
                  (so the gap here was 6px + 4px against 6px on every other card
                  on the page). */}
              <CardDescription>
                Every hourly refresh, manual refresh and spreadsheet upload, newest first — so you
                can see what came in and what went wrong.
              </CardDescription>
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
        </div>
      )}
    </div>
  );
}
