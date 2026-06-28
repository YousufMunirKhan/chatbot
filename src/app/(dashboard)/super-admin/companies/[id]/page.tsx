import Link from 'next/link';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { getCompanyDetail } from '@/modules/super-admin/data';
import { getCompanyEvalDetail } from '@/modules/super-admin/quality-data';
import { SUBSCRIPTION_STATUSES } from '@/modules/super-admin/plans';
import {
  grantCompanyRepliesAction,
  setCompanyStatusAction,
  topUpCompanyCreditAction,
  updateSubscriptionAction,
} from '@/modules/super-admin/actions';
import { CompanyStatusBadge } from '@/modules/super-admin/components/badges';
import { formatDate, formatNumber } from '@/lib/format';
import { ImpersonationForm } from '@/modules/super-admin/components/impersonation-form';
import { RunEvalButton } from '@/modules/super-admin/components/run-eval-button';
import { listBillingPlans } from '@/modules/super-admin/billing-data';
import { listChatLogs } from '@/modules/super-admin/chat-logs-data';

const selectCls =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

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
  { key: 'operator', label: 'Operator tools' },
] as const;

type TabKey = (typeof tabs)[number]['key'];

function money(value: number, currency = 'GBP') {
  return new Intl.NumberFormat(currency === 'USD' ? 'en-US' : 'en-GB', {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'USD' ? 4 : 2,
  }).format(value);
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
      <div>
        <Link href="/super-admin/companies" className="text-sm text-muted-foreground hover:underline">
          Back to companies
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{c.name}</h1>
          <CompanyStatusBadge status={c.status} />
        </div>
        {c.website ? (
          <a href={c.website} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">
            {c.website}
          </a>
        ) : null}
      </div>

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
            <Metric label="AI replies used" value={`${formatNumber(c.replyUsage.used)} / ${totalReplies}`} />
            <Metric label="Replies remaining" value={remainingReplies} />
            <Metric label="Extra replies" value={formatNumber(c.replyUsage.extraReplies)} />
            <Metric label="Internal AI cost" value={money(c.aiCostThisMonth, 'USD')} />
            <Metric label="Estimated revenue" value={money(c.estimatedRevenue)} />
            <Metric label="Estimated margin" value={money(c.estimatedProfit)} />
            <Metric label="Credit balance" value={c.creditAccount ? money(c.creditAccount.balanceAmount, c.creditAccount.currency) : 'Not tracked'} />
            <Metric label="WhatsApp" value={c.whatsapp.enabled ? c.whatsapp.senderMode : 'Not enabled'} />
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
                <Metric label="Base monthly replies" value={limit(c.replyUsage.monthlyAllowance)} />
                <Metric label="Extra replies" value={formatNumber(c.replyUsage.extraReplies)} />
                <Metric label="Used this month" value={formatNumber(c.replyUsage.used)} />
                <Metric label="Remaining" value={remainingReplies} />
                <Metric label="Reset date" value={formatDate(c.replyUsage.resetAt)} />
              </div>

              <form action={grantCompanyRepliesAction} className="grid gap-3 rounded-md border bg-muted/20 p-3 lg:grid-cols-[140px_170px_minmax(0,1fr)_170px_auto]">
                <input type="hidden" name="companyId" value={c.id} />
                <div className="space-y-1.5">
                  <Label htmlFor="replyCount">Extra replies</Label>
                  <Input id="replyCount" name="replyCount" type="number" min={1} placeholder="200" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="grantType">Type</Label>
                  <select id="grantType" name="grantType" className={selectCls} defaultValue="goodwill">
                    <option value="goodwill">Goodwill bonus</option>
                    <option value="paid_extra">Paid extra replies</option>
                    <option value="support_adjustment">Support adjustment</option>
                    <option value="manual">Manual</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reason">Note</Label>
                  <Input id="reason" name="reason" placeholder="Customer requested a one-off allowance" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="expiresAt">Expires</Label>
                  <Input id="expiresAt" name="expiresAt" type="date" />
                </div>
                <div className="flex items-end">
                  <Button type="submit" size="sm">Add replies</Button>
                </div>
              </form>

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
                <Metric label="Credit balance" value={c.creditAccount ? money(c.creditAccount.balanceAmount, c.creditAccount.currency) : 'Not tracked'} />
                <Metric label="Credit added" value={c.creditAccount ? money(c.creditAccount.lifetimeCreditAdded, c.creditAccount.currency) : '-'} />
                <Metric label="AI charged" value={c.creditAccount ? money(c.creditAccount.lifetimeUsageCharged, c.creditAccount.currency) : '-'} />
                <Metric label="Internal AI cost" value={money(c.aiCostThisMonth, 'USD')} />
              </div>

              <form action={topUpCompanyCreditAction} className="grid gap-3 rounded-md border bg-muted/20 p-3 sm:grid-cols-[160px_minmax(0,1fr)_auto]">
                <input type="hidden" name="companyId" value={c.id} />
                <div className="space-y-1.5">
                  <Label htmlFor="creditTopUpAmount">Top up (GBP)</Label>
                  <Input id="creditTopUpAmount" name="amount" type="number" min={0.01} step="0.01" placeholder="10.00" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="creditTopUpDescription">Note</Label>
                  <Input id="creditTopUpDescription" name="description" placeholder="Invoice paid, bonus credit, or manual adjustment" />
                </div>
                <div className="flex items-end">
                  <Button type="submit" size="sm">Add credit</Button>
                </div>
              </form>
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
            <form action={updateSubscriptionAction} className="space-y-4">
              <input type="hidden" name="companyId" value={c.id} />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Plan">
                  <select id="plan" name="plan" className={selectCls} defaultValue={sub.plan ?? 'free_trial'}>
                    {billingPlans.map((plan) => (
                      <option key={plan.key} value={plan.key}>{plan.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Status">
                  <select id="status" name="status" className={selectCls} defaultValue={sub.status ?? 'trialing'}>
                    {SUBSCRIPTION_STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Free until">
                  <Input id="freeUntil" name="freeUntil" type="date" defaultValue={sub.freeUntil ?? ''} />
                </Field>
                <Field label="Monthly AI replies">
                  <Input id="messageLimit" name="messageLimit" type="number" min={1} defaultValue={sub.messageLimit ?? ''} />
                </Field>
                <Field label="Team seats">
                  <Input id="agentLimit" name="agentLimit" type="number" min={0} defaultValue={sub.agentLimit ?? ''} />
                </Field>
                <Field label="Assistants">
                  <Input id="botLimit" name="botLimit" type="number" min={0} defaultValue={sub.botLimit ?? ''} />
                </Field>
                <Field label="Integrations">
                  <Input id="integrationLimit" name="integrationLimit" type="number" min={0} defaultValue={sub.integrationLimit ?? ''} />
                </Field>
              </div>
              <Button type="submit" size="sm">Save changes</Button>
            </form>
          </CardContent>
        </Card>
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
              <p className="px-6 pb-6 text-sm text-muted-foreground">No conversations saved yet.</p>
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
                  <span className="ml-2 align-middle">
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
              <p className="px-6 pb-6 text-sm text-muted-foreground">
                No graded run yet. Add sample questions, then run a graded evaluation.
              </p>
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
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
              <p className="mb-3 text-sm text-amber-950">
                Sensitive support access. Start a time-limited impersonation session only when needed,
                and include a clear reason.
              </p>
              <ImpersonationForm companyId={c.id} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href={`/super-admin/companies/${c.id}/manage`}>Manage company setup</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/super-admin/usage">Usage and cost</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/super-admin/audit-logs">Audit logs</Link>
              </Button>
            </div>
            <form action={setCompanyStatusAction}>
              <input type="hidden" name="companyId" value={c.id} />
              <input type="hidden" name="status" value={isActive ? 'suspended' : 'active'} />
              <Button type="submit" variant={isActive ? 'destructive' : 'default'} size="sm">
                {isActive ? 'Suspend company' : 'Activate company'}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b pb-2 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
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
          <p className="px-6 pb-6 text-sm text-muted-foreground">{empty}</p>
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
