import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile } from '@/components/ui/stat-tile';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { requireRole } from '@/lib/auth';
import { ROLES, QUICK_ACTION_TYPE_LABELS, labelFor } from '@/lib/constants';
import { formatNumber } from '@/lib/format';
import { getQuickActionAnalytics } from '@/modules/company/quick-action-analytics-data';

export default async function QuickActionAnalyticsPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const data = await getQuickActionAnalytics();
  const conversion = data.totalClicks
    ? Math.round((data.totalCompleted / data.totalClicks) * 100)
    : 0;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        backTo={{ href: '/company/quick-actions', label: 'Chat buttons' }}
        title="How your chat buttons are doing"
        description="Taps over the last 30 days, and how many of those turned into a booking or a set of contact details."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Taps" value={formatNumber(data.totalClicks)} />
        <StatTile label="Finished what they started" value={formatNumber(data.totalCompleted)} />
        <StatTile label="Share that finished" value={`${conversion}%`} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Every button</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Button</TableHead>
                <TableHead>What it does</TableHead>
                <TableHead>Taps</TableHead>
                <TableHead>Finished</TableHead>
                <TableHead>Share that finished</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row) => (
                <TableRow key={`${row.actionId ?? row.label}-${row.actionType}`}>
                  <TableCell className="font-medium">{row.label}</TableCell>
                  <TableCell>{labelFor(QUICK_ACTION_TYPE_LABELS, row.actionType)}</TableCell>
                  <TableCell>{formatNumber(row.clicks)}</TableCell>
                  <TableCell>{formatNumber(row.completed)}</TableCell>
                  <TableCell>
                    <Badge variant={row.conversionRate ? 'success' : 'secondary'}>
                      {row.conversionRate}%
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {data.rows.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="p-0">
                    <EmptyState title="Nobody has tapped a chat button yet." />
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
