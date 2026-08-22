import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile } from '@/components/ui/stat-tile';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { getCompanyAnalytics } from '@/modules/company/analytics-data';
import { formatDate, formatNumber } from '@/lib/format';

export default async function CompanyUsagePage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const a = await getCompanyAnalytics();
  const replyLimitLabel =
    a.replyUsage.totalAvailable == null ? 'Unlimited' : formatNumber(a.replyUsage.totalAvailable);
  const remainingLabel =
    a.replyUsage.remaining == null ? 'Unlimited' : formatNumber(a.replyUsage.remaining);
  const pct = (v: number | null) => (v == null ? '-' : `${Math.round(v * 100)}%`);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Usage"
        description="Your monthly AI reply allowance and business activity."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="AI replies used" value={`${formatNumber(a.replyUsage.used)} / ${replyLimitLabel}`} />
        <StatTile label="Replies remaining" value={remainingLabel} />
        <StatTile label="Extra replies added" value={formatNumber(a.replyUsage.extraReplies)} />
        <StatTile label="Allowance resets" value={formatDate(a.replyUsage.resetAt)} />
        <StatTile label="Total chat messages" value={formatNumber(a.totalChatMessagesThisMonth)} />
        <StatTile label="Leads" value={formatNumber(a.leads)} />
        <StatTile label="Appointments" value={formatNumber(a.appointments)} />
        <StatTile label="Orders" value={formatNumber(a.chatOrders)} />
        <StatTile label="Conversations" value={formatNumber(a.conversations)} />
        <StatTile label="AI-handled" value={formatNumber(a.aiHandled)} />
        <StatTile label="Human-handled" value={formatNumber(a.humanHandled)} />
      </div>

      <div>
        <h2 className="text-lg font-semibold">Support performance</h2>
        <p className="text-sm text-muted-foreground">
          How much of your support the assistant resolves on its own — the numbers that justify the AI spend.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="AI deflection rate" value={pct(a.deflectionRate)} />
        <StatTile label="Resolution rate" value={pct(a.resolutionRate)} />
        <StatTile label="Resolved conversations" value={formatNumber(a.closed)} />
        <StatTile
          label="CSAT"
          value={a.csatAverage != null ? `${a.csatAverage.toFixed(1)}★ (${formatNumber(a.csatResponses)})` : 'No ratings yet'}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Monthly allowance rules</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Your plan includes {a.replyUsage.monthlyAllowance == null ? 'unlimited' : formatNumber(a.replyUsage.monthlyAllowance)} AI replies per billing month.
            Unused replies expire at the end of the billing month and do not roll over.
          </p>
          {a.replyUsage.extraReplies > 0 ? (
            <p>
              Support has added {formatNumber(a.replyUsage.extraReplies)} extra replies for the current period.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
