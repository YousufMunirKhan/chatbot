import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { getCompanyAnalytics } from '@/modules/company/analytics-data';
import { formatCurrency, formatNumber } from '@/lib/format';

export default async function CompanyUsagePage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const a = await getCompanyAnalytics();
  const limitLabel = a.messageLimit == null ? 'Unlimited' : formatNumber(a.messageLimit);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <p className="text-sm text-muted-foreground">Your activity and AI spend this month.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Messages used" value={`${formatNumber(a.messagesThisMonth)} / ${limitLabel}`} />
        <Metric label="AI cost (this month)" value={formatCurrency(a.aiCostThisMonth)} />
        <Metric label="Leads" value={formatNumber(a.leads)} />
        <Metric label="Appointments" value={formatNumber(a.appointments)} />
        <Metric label="Orders" value={formatNumber(a.chatOrders)} />
        <Metric label="Conversations" value={formatNumber(a.conversations)} />
        <Metric label="AI-handled" value={formatNumber(a.aiHandled)} />
        <Metric label="Human-handled" value={formatNumber(a.humanHandled)} />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}
