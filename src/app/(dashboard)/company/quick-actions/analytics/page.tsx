import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile } from '@/components/ui/stat-tile';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { formatNumber } from '@/lib/format';
import { getQuickActionAnalytics } from '@/modules/company/quick-action-analytics-data';

export default async function QuickActionAnalyticsPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const data = await getQuickActionAnalytics();
  const conversion = data.totalClicks ? Math.round((data.totalCompleted / data.totalClicks) * 100) : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        backTo={{ href: '/company/quick-actions', label: 'Quick Actions' }}
        title="Quick Action Analytics"
        description="Clicks and completed lead/appointment actions from the last 30 days."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Clicks" value={formatNumber(data.totalClicks)} />
        <StatTile label="Completed" value={formatNumber(data.totalCompleted)} />
        <StatTile label="Conversion" value={`${conversion}%`} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Actions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Action</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Clicks</TableHead>
                <TableHead>Completed</TableHead>
                <TableHead>Conversion</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row) => (
                <TableRow key={`${row.actionId ?? row.label}-${row.actionType}`}>
                  <TableCell className="font-medium">{row.label}</TableCell>
                  <TableCell>{row.actionType.replace(/_/g, ' ')}</TableCell>
                  <TableCell>{formatNumber(row.clicks)}</TableCell>
                  <TableCell>{formatNumber(row.completed)}</TableCell>
                  <TableCell><Badge variant={row.conversionRate ? 'success' : 'secondary'}>{row.conversionRate}%</Badge></TableCell>
                </TableRow>
              ))}
              {data.rows.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="p-0">
                    <EmptyState title="No quick action clicks yet." />
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
