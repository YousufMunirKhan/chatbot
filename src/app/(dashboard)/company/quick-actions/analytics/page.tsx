import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { formatNumber } from '@/lib/format';
import { getQuickActionAnalytics } from '@/modules/company/quick-action-analytics-data';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

export default async function QuickActionAnalyticsPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const data = await getQuickActionAnalytics();
  const conversion = data.totalClicks ? Math.round((data.totalCompleted / data.totalClicks) * 100) : 0;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/company/quick-actions" className="text-sm text-muted-foreground hover:underline">
          Back to quick actions
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Quick Action Analytics</h1>
        <p className="text-sm text-muted-foreground">Clicks and completed lead/appointment actions from the last 30 days.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Clicks" value={formatNumber(data.totalClicks)} />
        <Stat label="Completed" value={formatNumber(data.totalCompleted)} />
        <Stat label="Conversion" value={`${conversion}%`} />
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
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">No quick action clicks yet.</TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
