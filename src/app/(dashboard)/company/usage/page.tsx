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
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Usage & limits"
        description="How many replies your plan includes each month, how many you have used, and how busy things have been."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 [&>*]:min-w-0">
        <StatTile
          label="Replies used this month"
          value={`${formatNumber(a.replyUsage.used)} / ${replyLimitLabel}`}
        />
        <StatTile label="Replies left" value={remainingLabel} />
        <StatTile label="Extra replies bought" value={formatNumber(a.replyUsage.extraReplies)} />
        <StatTile label="Starts again on" value={formatDate(a.replyUsage.resetAt)} />
        <StatTile label="Messages in total" value={formatNumber(a.totalChatMessagesThisMonth)} />
        <StatTile label="Enquiries" value={formatNumber(a.leads)} />
        <StatTile label="Bookings" value={formatNumber(a.appointments)} />
        <StatTile label="Orders" value={formatNumber(a.chatOrders)} />
        <StatTile label="Chats" value={formatNumber(a.conversations)} />
        <StatTile label="Finished by the assistant" value={formatNumber(a.aiHandled)} />
        <StatTile label="Needed one of your team" value={formatNumber(a.humanHandled)} />
      </div>

      <div>
        <h2 className="text-lg font-semibold">How much work it saved you</h2>
        <p className="text-sm text-muted-foreground">
          How much of your customer service the assistant got through without anybody stepping in.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 [&>*]:min-w-0">
        {/* Every tile in this row is a ratio, and a bare percentage is a fact
            with no meaning attached. The hint says what the percentage is OF. */}
        <StatTile
          label="Handled without you"
          value={pct(a.deflectionRate)}
          hint="Chats the assistant finished on its own"
        />
        <StatTile
          label="Reached an answer"
          value={pct(a.resolutionRate)}
          hint="Chats that ended sorted, by anyone"
        />
        <StatTile
          label="Chats closed"
          value={formatNumber(a.closed)}
          hint="Marked finished this month"
        />
        <StatTile
          label="What customers thought"
          value={
            a.csatAverage != null ? `${a.csatAverage.toFixed(1)}★` : 'Nobody has rated you yet'
          }
          hint={
            a.csatAverage != null
              ? `Average of ${formatNumber(a.csatResponses)} ratings`
              : 'Ratings appear once customers start leaving them'
          }
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">How the monthly allowance works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Your plan includes{' '}
            {a.replyUsage.monthlyAllowance == null
              ? 'as many replies as you need'
              : `${formatNumber(a.replyUsage.monthlyAllowance)} replies`}{' '}
            each month. Anything you do not use is gone at the end of the month — it does not carry
            over to the next one.
          </p>
          {a.replyUsage.extraReplies > 0 ? (
            <p>
              We have added {formatNumber(a.replyUsage.extraReplies)} extra replies to this month
              for you.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
