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
        description="How many AI replies your plan includes each month, how many you have used, and how busy things have been."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 [&>*]:min-w-0">
        <StatTile
          label="AI replies used this month"
          value={`${formatNumber(a.replyUsage.used)} / ${replyLimitLabel}`}
        />
        <StatTile label="AI replies left" value={remainingLabel} />
        {/* Was "Extra replies bought", which described a purchase nobody can
            make: extra replies come from a super-admin grant, and the only
            thing a customer can buy is prepaid AI credit, which is a different
            meter on the billing page. A customer reading "bought" reasonably
            concluded their top-up had added these, and then could not find
            where to buy more. */}
        <StatTile
          label="Extra replies added by support"
          value={formatNumber(a.replyUsage.extraReplies)}
          hint="Granted to your account, not bought"
        />
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
              ? 'as many AI replies as you need'
              : `${formatNumber(a.replyUsage.monthlyAllowance)} AI replies`}{' '}
            each month. One reply is one message written by the assistant, so a customer asking four
            questions in a single chat uses four. Messages your own team types are free and do not
            count. Anything you do not use is gone at the end of the month — it does not carry over
            to the next one.
          </p>
          <p>
            When the allowance is used up the assistant stops writing AI answers and says a team
            member will follow up. Nothing is charged for going over, the messages still reach your
            inbox, and a larger package raises the allowance straight away — see your billing page.
          </p>
          {a.replyUsage.extraReplies > 0 ? (
            <p>
              Support has added {formatNumber(a.replyUsage.extraReplies)} extra replies to this
              month for you. These are a grant rather than a purchase, and they are separate from
              the prepaid AI credit on your billing page.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
