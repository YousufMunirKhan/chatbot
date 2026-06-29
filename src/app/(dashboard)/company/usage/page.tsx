import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Usage</h1>
        <p className="text-sm text-muted-foreground">
          Your monthly AI reply allowance and business activity.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="AI replies used" value={`${formatNumber(a.replyUsage.used)} / ${replyLimitLabel}`} />
        <Metric label="Replies remaining" value={remainingLabel} />
        <Metric label="Extra replies added" value={formatNumber(a.replyUsage.extraReplies)} />
        <Metric label="Allowance resets" value={formatDate(a.replyUsage.resetAt)} />
        <Metric label="Total chat messages" value={formatNumber(a.totalChatMessagesThisMonth)} />
        <Metric label="Leads" value={formatNumber(a.leads)} />
        <Metric label="Appointments" value={formatNumber(a.appointments)} />
        <Metric label="Orders" value={formatNumber(a.chatOrders)} />
        <Metric label="Conversations" value={formatNumber(a.conversations)} />
        <Metric label="AI-handled" value={formatNumber(a.aiHandled)} />
        <Metric label="Human-handled" value={formatNumber(a.humanHandled)} />
      </div>

      <div>
        <h2 className="text-lg font-semibold">Support performance</h2>
        <p className="text-sm text-muted-foreground">
          How much of your support the assistant resolves on its own — the numbers that justify the AI spend.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="AI deflection rate" value={pct(a.deflectionRate)} />
        <Metric label="Resolution rate" value={pct(a.resolutionRate)} />
        <Metric label="Resolved conversations" value={formatNumber(a.closed)} />
        <Metric
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
