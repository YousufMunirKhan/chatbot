import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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
import { Badge } from '@/components/ui/badge';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { getCompanyDetail } from '@/modules/super-admin/data';
import { getCompanyEvalDetail } from '@/modules/super-admin/quality-data';
import { CompanyStatusBadge } from '@/modules/super-admin/components/badges';
import { formatDate, formatNumber } from '@/lib/format';
import { gbp, usd } from '@/modules/super-admin/money';
import { ImpersonationForm } from '@/modules/super-admin/components/impersonation-form';
import { RunEvalButton } from '@/modules/super-admin/components/run-eval-button';
import { SubscriptionForm } from '@/modules/super-admin/components/subscription-form';
import { CreditTopUpForm } from '@/modules/super-admin/components/credit-top-up-form';
import { ReplyGrantForm } from '@/modules/super-admin/components/reply-grant-form';
import { CompanyStatusForm } from '@/modules/super-admin/components/company-status-form';
import { listBillingPlans } from '@/modules/super-admin/billing-data';
import { listChatLogs } from '@/modules/super-admin/chat-logs-data';

const tabs = [
  { key: 'overview', label: 'Overview' },
  { key: 'usage', label: 'Usage & replies' },
  { key: 'plan', label: 'Plan & limits' },
  { key: 'integrations', label: 'Integrations' },
  { key: 'team', label: 'Team' },
  { key: 'assistants', label: 'Assistants' },
  { key: 'chats', label: 'Chats' },
  { key: 'quality', label: 'Quality' },
  { key: 'activity', label: 'Activity' },
  { key: 'commercial', label: 'Charges & add-ons' },
  { key: 'operator', label: 'Operator tools' },
] as const;

type TabKey = (typeof tabs)[number]['key'];

/**
 * Wallet rows carry their own currency column, so this one formatter has to
 * respect it. Platform revenue/cost figures use the shared `gbp`/`usd` helpers.
 */
function money(value: number, currency: string) {
  return currency === 'USD' ? usd(value) : gbp(value);
}

function limit(value: number | null) {
  return value == null ? 'Unlimited' : formatNumber(value);
}

function activeTab(raw: string | undefined): TabKey {
  return tabs.some((tab) => tab.key === raw) ? (raw as TabKey) : 'overview';
}

export default async function CompanyDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { tab?: string };
}) {
  // Defence in depth: the /super-admin layout guards the subtree, but this page
  // reads every tenant's commercials through the service-role client, so it
  // re-checks the role itself rather than trusting a parent it does not own.
  await requireRole([ROLES.SUPER_ADMIN]);
  const c = await getCompanyDetail(params.id);
  if (!c) notFound();
  const tab = activeTab(searchParams?.tab);
  const [evalDetail, billingPlans] = await Promise.all([
    getCompanyEvalDetail(params.id),
    listBillingPlans(),
  ]);
  const chatLogs = tab === 'chats' ? await listChatLogs({ companyId: params.id, limit: 100 }) : [];

  const sub = c.subscription;
  const isActive = c.status === 'active';
  const totalReplies =
    c.replyUsage.totalAvailable == null ? 'Unlimited' : formatNumber(c.replyUsage.totalAvailable);
  const remainingReplies =
    c.replyUsage.remaining == null ? 'Unlimited' : formatNumber(c.replyUsage.remaining);

  return (
    <div className="space-y-6">
      <PageHeader
        backTo={{ href: '/super-admin/companies', label: 'Back to companies' }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {c.name}
            <CompanyStatusBadge status={c.status} />
          </span>
        }
        description={
          c.website ? (
            <a href={c.website} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">
              {c.website}
            </a>
          ) : undefined
        }
      />

      <div className="flex flex-wrap gap-2 border-b">
        {tabs.map((item) => (
          <Link
            key={item.key}
            href={`/super-admin/companies/${c.id}?tab=${item.key}`}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${
              tab === item.key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      {tab === 'overview' ? (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="AI replies used" value={`${formatNumber(c.replyUsage.used)} / ${totalReplies}`} />
            <StatTile label="Replies remaining" value={remainingReplies} />
            <StatTile label="Extra replies" value={formatNumber(c.replyUsage.extraReplies)} />
            <StatTile
              label="Internal AI cost (USD)"
              value={usd(c.aiCostThisMonth)}
              hint={`${gbp(c.aiCostThisMonthGbp)} at the platform FX rate`}
            />
            <StatTile
              label="Estimated revenue (GBP)"
              value={gbp(c.estimatedRevenueGbp)}
              hint={`plan ${gbp(c.planRevenueGbp)} + add-ons ${gbp(c.addonRevenueGbp)}`}
            />
            <StatTile
              label="Estimated margin (GBP)"
              value={gbp(c.estimatedProfitGbp)}
              hint="GBP revenue minus AI cost converted to GBP"
            />
            <StatTile label="Credit balance" value={c.creditAccount ? money(c.creditAccount.balanceAmount, c.creditAccount.currency) : 'Not tracked'} />
            <StatTile label="WhatsApp" value={c.whatsapp.enabled ? c.whatsapp.senderMode : 'Not enabled'} />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Company summary</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
              <Row label="Country" value={c.country ?? '-'} />
              <Row label="Default language" value={c.defaultLanguage} />
              <Row label="Created" value={formatDate(c.createdAt)} />
              <Row label="Plan" value={sub.plan ?? '-'} />
              <Row label="Subscription" value={sub.status ?? '-'} />
              <Row label="Allowance resets" value={formatDate(c.replyUsage.resetAt)} />
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === 'usage' ? (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>AI reply allowance</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <StatTile label="Base monthly replies" value={limit(c.replyUsage.monthlyAllowance)} />
                <StatTile label="Extra replies" value={formatNumber(c.replyUsage.extraReplies)} />
                <StatTile label="Used this month" value={formatNumber(c.replyUsage.used)} />
                <StatTile label="Remaining" value={remainingReplies} />
                <StatTile label="Reset date" value={formatDate(c.replyUsage.resetAt)} />
              </div>

              <ReplyGrantForm companyId={c.id} />

              <p className="text-xs text-muted-foreground">
                Extra replies are added on top of the monthly plan allowance. If no expiry is chosen,
                they expire at the end of the current billing month.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Credit and cost controls</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatTile label="Credit balance" value={c.creditAccount ? money(c.creditAccount.balanceAmount, c.creditAccount.currency) : 'Not tracked'} />
                <StatTile label="Credit added" value={c.creditAccount ? money(c.creditAccount.lifetimeCreditAdded, c.creditAccount.currency) : '-'} />
                <StatTile label="AI charged" value={c.creditAccount ? money(c.creditAccount.lifetimeUsageCharged, c.creditAccount.currency) : '-'} />
                <StatTile
                  label="Internal AI cost (USD)"
                  value={usd(c.aiCostThisMonth)}
                  hint={`${gbp(c.aiCostThisMonthGbp)} at the platform FX rate`}
                />
              </div>

              <CreditTopUpForm companyId={c.id} />
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <SimpleTable
              title="Recent reply grants"
              empty="No extra replies granted."
              headers={['Replies', 'Type', 'Expires', 'Note']}
              rows={c.replyUsage.grants.map((grant) => [
                formatNumber(grant.replyCount),
                grant.grantType.replace(/_/g, ' '),
                formatDate(grant.expiresAt),
                grant.reason,
              ])}
            />
            <SimpleTable
              title="Recent credit movements"
              empty="No credit movements yet."
              headers={['Type', 'Amount', 'Created']}
              rows={c.creditTransactions.map((tx) => [
                tx.description ?? tx.type,
                money(tx.amount, tx.currency),
                formatDate(tx.createdAt),
              ])}
            />
          </div>
        </div>
      ) : null}

      {tab === 'plan' ? (
        <Card>
          <CardHeader>
            <CardTitle>Plan and limits</CardTitle>
          </CardHeader>
          <CardContent>
            {/* `featureOverrides` and `includedCreditGbp` are passed separately
                from `subscription` because the form takes each as its own prop:
                both are per-company exceptions the form both reads and writes,
                and the credit box drew empty on every company until this line
                gave it the stored figure. */}
            <SubscriptionForm
              companyId={c.id}
              subscription={sub}
              plans={billingPlans}
              featureOverrides={sub.featureOverrides}
              includedCreditGbp={sub.includedCreditGbp}
            />
          </CardContent>
        </Card>
      ) : null}

      {tab === 'commercial' ? (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <StatTile label="Plan revenue (GBP)" value={gbp(c.planRevenueGbp)} hint="per month" />
            <StatTile
              label="Add-on revenue (GBP)"
              value={gbp(c.addonRevenueGbp)}
              hint="active add-ons, per month"
            />
            <StatTile
              label="Total recurring (GBP)"
              value={gbp(c.estimatedRevenueGbp)}
              hint="what the Profit screen counts"
            />
          </div>
          <SimpleTable
            title="Add-ons"
            empty="No add-ons on this company."
            headers={['Add-on', 'Price / month', 'Status']}
            rows={c.addons.map((addon) => [
              addon.label,
              money(addon.priceMonthly, addon.currency),
              addon.status,
            ])}
          />
          <SimpleTable
            title="One-off commercial charges"
            empty="No setup fees or one-off charges recorded."
            headers={['Charge', 'Amount', 'Status', 'Note', 'Raised']}
            rows={c.commercialCharges.map((charge) => [
              charge.chargeType.replace(/_/g, ' '),
              money(charge.amount, charge.currency),
              charge.status,
              charge.description ?? '-',
              formatDate(charge.createdAt),
            ])}
          />
          <p className="text-xs text-muted-foreground">
            One-off charges (setup fees) are recorded here for invoicing but are deliberately
            excluded from the monthly margin on the Profit screen, which counts recurring revenue
            only. Newest 8 charges shown.
          </p>
        </div>
      ) : null}

      {tab === 'integrations' ? (
        <Card>
          <CardHeader>
            <CardTitle>Integrations and WhatsApp</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
            <Row label="WhatsApp status" value={c.whatsapp.enabled ? 'Enabled' : 'Not enabled'} />
            <Row label="WhatsApp owner" value={c.whatsapp.senderMode} />
            <Row label="WhatsApp provider" value={c.whatsapp.provider} />
            <Row label="WhatsApp recipients" value={formatNumber(c.whatsapp.recipientCount)} />
            <Row label="Connected integrations" value={formatNumber(c.counts?.integrations ?? 0)} />
            <Row label="Integration limit" value={limit(sub.integrationLimit)} />
            <p className="sm:col-span-2 text-sm text-muted-foreground">
              Company-managed WhatsApp means the company supplies and pays for its own Meta or Twilio sender.
              Platform-managed WhatsApp should only be used as an explicit paid managed service.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {tab === 'team' ? (
        <SimpleTable
          title="Team"
          empty="No members."
          headers={['Name', 'Email', 'Role']}
          rows={c.members.map((m) => [m.fullName ?? '-', m.email ?? '-', m.role])}
        />
      ) : null}

      {tab === 'assistants' ? (
        <SimpleTable
          title="Assistants"
          empty="No assistants yet."
          headers={['Name', 'Type', 'AI', 'Public bot ID']}
          rows={c.bots.map((b) => [b.name, b.botType, b.aiEnabled ? 'On' : 'Off', b.publicBotId])}
        />
      ) : null}

      {tab === 'chats' ? (
        <Card>
          <CardHeader>
            <CardTitle>Recent chats</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {chatLogs.length === 0 ? (
              <EmptyState title="No conversations saved yet." className="pt-0" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Visitor</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Audit</TableHead>
                    <TableHead>Latest question</TableHead>
                    <TableHead>Last activity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {chatLogs.map((chat) => (
                    <TableRow key={chat.id}>
                      <TableCell className="font-mono text-xs">
                        <Link href={`/super-admin/chat-logs/${chat.id}`} className="text-primary hover:underline">
                          {chat.visitorId ?? chat.id.slice(0, 8)}
                        </Link>
                      </TableCell>
                      <TableCell>{chat.status.replace(/_/g, ' ')}</TableCell>
                      <TableCell>
                        <Badge variant={chat.qualityStatus === 'perfect' ? 'success' : chat.qualityStatus === 'failed' ? 'destructive' : chat.qualityStatus === 'needs_review' ? 'warning' : 'secondary'}>
                          {(chat.qualityStatus ?? 'not audited').replace(/_/g, ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-md truncate">{chat.latestQuestion ?? '-'}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(chat.lastMessageAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}

      {tab === 'quality' ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>
                Assistant evaluation
                {evalDetail?.avgAnswerScore != null ? (
                  <span className="ms-2 align-middle">
                    <Badge variant={evalDetail.avgAnswerScore >= 70 ? 'success' : 'warning'}>
                      {evalDetail.avgAnswerScore}% answer quality
                    </Badge>
                  </span>
                ) : null}
              </CardTitle>
              <RunEvalButton companyId={c.id} />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {!evalDetail ? (
              <EmptyState
                title="No graded run yet. Add sample questions, then run a graded evaluation."
                className="pt-0"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Question</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Verdict</TableHead>
                    <TableHead>What to fix</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {evalDetail.results.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="max-w-xs align-top font-medium">{r.question}</TableCell>
                      <TableCell>{r.score == null ? '-' : `${r.score}%`}</TableCell>
                      <TableCell>
                        <Badge variant={r.verdict === 'pass' ? 'success' : 'warning'}>{r.verdict ?? '-'}</Badge>
                      </TableCell>
                      <TableCell className="max-w-xs text-muted-foreground">{r.fix || r.rationale || '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}

      {tab === 'activity' ? (
        <SimpleTable
          title="Recent activity"
          empty="No activity recorded."
          headers={['When', 'Action', 'By']}
          rows={c.audits.map((a) => [formatDate(a.createdAt), a.action, a.actorEmail ?? 'system'])}
        />
      ) : null}

      {tab === 'operator' ? (
        <Card>
          <CardHeader>
            <CardTitle>Operator tools</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/*
              Amber here means "sensitive access", which is the `warning` tone —
              distinct from the `info` notes on the money screens that used to
              share the same hardcoded amber.
            */}
            <Alert tone="warning">
              <p className="mb-3">
                Sensitive support access. Start a time-limited impersonation session only when needed,
                and include a clear reason.
              </p>
              <ImpersonationForm companyId={c.id} />
            </Alert>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href={`/super-admin/companies/${c.id}/manage`}>Manage company setup</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/super-admin/usage">Usage and cost</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/super-admin/costs">AI cost</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/super-admin/profit">Profit / loss</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/super-admin/subscriptions">Subscriptions</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/super-admin/integrations">Integrations</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/super-admin/audit-logs">Audit logs</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/super-admin/security">Security logs</Link>
              </Button>
            </div>
            <CompanyStatusForm companyId={c.id} companyName={c.name} isActive={isActive} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

/**
 * Read-only label/value pair inside a summary card. Deliberately not
 * `FormField`: there is no control here, and `FormField` renders a `<label>`
 * pointing at one.
 */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b pb-2 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-end font-medium">{value}</span>
    </div>
  );
}

function SimpleTable({
  title,
  empty,
  headers,
  rows,
}: {
  title: string;
  empty: string;
  headers: string[];
  rows: string[][];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <EmptyState title={empty} className="pt-0" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {headers.map((header) => (
                  <TableHead key={header}>{header}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, rowIndex) => (
                <TableRow key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <TableCell key={cellIndex} className={cellIndex === 0 ? 'font-medium' : undefined}>
                      {cell}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
