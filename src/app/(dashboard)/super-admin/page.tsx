import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile } from '@/components/ui/stat-tile';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getOverviewStats } from '@/modules/super-admin/data';
import { planLabel } from '@/modules/super-admin/plans';
import { CompanyStatusBadge } from '@/modules/super-admin/components/badges';
import { formatDate, formatNumber } from '@/lib/format';
import { gbp, usd } from '@/modules/super-admin/money';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';

export default async function SuperAdminOverview() {
  await requireRole([ROLES.SUPER_ADMIN]);
  const s = await getOverviewStats();
  const attentionItems = [
    { label: 'Suspended companies', value: formatNumber(s.suspended), href: '/super-admin/companies' },
    { label: 'Trial accounts', value: formatNumber(s.trialing), href: '/super-admin/subscriptions' },
    { label: 'AI cost this month', value: usd(s.aiCostUsd), href: '/super-admin/costs' },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Command Center"
        description="The main operating view for companies, billing, usage, quality, and risk."
        actions={
          <>
            <Button asChild>
              <Link href="/super-admin/companies/new">Onboard company</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/super-admin/quality">Review quality</Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Companies" value={formatNumber(s.total)} hint={`${s.active} active, ${s.suspended} suspended`} />
        <StatTile label="On trial" value={formatNumber(s.trialing)} />
        <StatTile label="Assistants" value={formatNumber(s.bots)} />
        <StatTile label="Estimated MRR" value={gbp(s.mrrGbp)} hint="GBP · active paid plans + add-ons" />
        <StatTile label="AI cost" value={usd(s.aiCostUsd)} hint={`USD · current month (${gbp(s.aiCostGbp)})`} />
        <StatTile label="Profit" value={gbp(s.profitGbp)} hint="GBP · MRR minus AI cost converted to GBP" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
        <Card>
          <CardHeader>
            <CardTitle>Needs attention</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {attentionItems.map((item) => (
              <Link key={item.label} href={item.href} className="flex items-center justify-between rounded-md border p-3 hover:bg-muted/50">
                <span className="text-sm font-medium">{item.label}</span>
                <span className="text-sm text-muted-foreground">{item.value}</span>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Admin workspaces</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Link href="/super-admin/companies" className="rounded-md border p-3 hover:bg-muted/50">
              <p className="text-sm font-medium">Companies</p>
              <p className="mt-1 text-xs text-muted-foreground">Onboard, inspect, suspend, and impersonate.</p>
            </Link>
            <Link href="/super-admin/billing" className="rounded-md border p-3 hover:bg-muted/50">
              <p className="text-sm font-medium">Billing and plans</p>
              <p className="mt-1 text-xs text-muted-foreground">Prices, subscriptions, and platform billing.</p>
            </Link>
            <Link href="/super-admin/quality" className="rounded-md border p-3 hover:bg-muted/50">
              <p className="text-sm font-medium">Quality and usage</p>
              <p className="mt-1 text-xs text-muted-foreground">Answer quality, cost, profit, and evaluations.</p>
            </Link>
            <Link href="/super-admin/settings" className="rounded-md border p-3 hover:bg-muted/50">
              <p className="text-sm font-medium">Settings and security</p>
              <p className="mt-1 text-xs text-muted-foreground">Platform controls, logs, and governance.</p>
            </Link>
          </CardContent>
          {/*
            The sidebar (`PLATFORM_NAV`, owned elsewhere) lists nine entries and
            none of these six, so until it does this is the only way into them.
          */}
          <CardContent className="border-t pt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Money and operations
            </p>
            <div className="flex flex-wrap gap-2 text-sm">
              {[
                { href: '/super-admin/profit', label: 'Profit / loss' },
                { href: '/super-admin/costs', label: 'AI cost' },
                { href: '/super-admin/usage', label: 'Usage' },
                { href: '/super-admin/subscriptions', label: 'Subscriptions' },
                { href: '/super-admin/integrations', label: 'Integrations' },
                { href: '/super-admin/security', label: 'Security logs' },
              ].map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md border px-3 py-1.5 hover:bg-muted/50"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Recent companies</CardTitle>
          <Link href="/super-admin/companies" className="text-sm text-primary hover:underline">
            View all
          </Link>
        </CardHeader>
        <CardContent>
          {s.recent.length === 0 ? (
            <EmptyState
              title={
                <>
                  No companies yet.{' '}
                  <Link href="/super-admin/companies/new" className="text-primary hover:underline">
                    Onboard your first company
                  </Link>
                  .
                </>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.recent.map((company) => (
                  <TableRow key={company.id}>
                    <TableCell>
                      <Link href={`/super-admin/companies/${company.id}`} className="font-medium text-primary hover:underline">
                        {company.name}
                      </Link>
                    </TableCell>
                    <TableCell><CompanyStatusBadge status={company.status} /></TableCell>
                    <TableCell>{planLabel(company.plan)}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(company.createdAt)}</TableCell>
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
