import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getOverviewStats } from '@/modules/super-admin/data';
import { planLabel } from '@/modules/super-admin/plans';
import { CompanyStatusBadge } from '@/modules/super-admin/components/badges';
import { formatCurrency, formatDate, formatNumber } from '@/lib/format';

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
        <div className="mt-1 text-2xl font-semibold">{value}</div>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export default async function SuperAdminOverview() {
  const s = await getOverviewStats();
  const attentionItems = [
    { label: 'Suspended companies', value: formatNumber(s.suspended), href: '/super-admin/companies' },
    { label: 'Trial accounts', value: formatNumber(s.trialing), href: '/super-admin/subscriptions' },
    { label: 'AI cost this month', value: formatCurrency(s.aiCost), href: '/super-admin/usage' },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Command Center</h1>
          <p className="text-sm text-muted-foreground">
            The main operating view for companies, billing, usage, quality, and risk.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/super-admin/companies/new">Onboard company</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/super-admin/quality">Review quality</Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Companies" value={formatNumber(s.total)} hint={`${s.active} active, ${s.suspended} suspended`} />
        <Stat label="On trial" value={formatNumber(s.trialing)} />
        <Stat label="Assistants" value={formatNumber(s.bots)} />
        <Stat label="Estimated MRR" value={formatCurrency(s.mrr)} hint="active paid plans" />
        <Stat label="AI cost" value={formatCurrency(s.aiCost)} hint="current month" />
        <Stat label="Profit" value={formatCurrency(s.profit)} hint="revenue minus AI cost" />
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
            <p className="text-sm text-muted-foreground">
              No companies yet. <Link href="/super-admin/companies/new" className="text-primary hover:underline">Onboard your first company</Link>.
            </p>
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
