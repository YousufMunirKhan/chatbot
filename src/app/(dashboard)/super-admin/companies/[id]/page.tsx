import Link from 'next/link';
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
  setCompanyStatusAction,
  topUpCompanyCreditAction,
  updateSubscriptionAction,
} from '@/modules/super-admin/actions';
import { CompanyStatusBadge } from '@/modules/super-admin/components/badges';
import { formatDate } from '@/lib/format';
import { ImpersonationForm } from '@/modules/super-admin/components/impersonation-form';
import { RunEvalButton } from '@/modules/super-admin/components/run-eval-button';
import { listBillingPlans } from '@/modules/super-admin/billing-data';

const selectCls =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function money(value: number, currency = 'GBP') {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(value);
}

export default async function CompanyDetailPage({ params }: { params: { id: string } }) {
  const c = await getCompanyDetail(params.id);
  if (!c) notFound();
  const [evalDetail, billingPlans] = await Promise.all([
    getCompanyEvalDetail(params.id),
    listBillingPlans(),
  ]);

  const sub = c.subscription;
  const isActive = c.status === 'active';

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/super-admin/companies"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Companies
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{c.name}</h1>
          <CompanyStatusBadge status={c.status} />
        </div>
        {c.website ? (
          <a
            href={c.website}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-primary hover:underline"
          >
            {c.website}
          </a>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>AI credit and commercial controls</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-md border p-3">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Credit balance
              </p>
              <p className="mt-1 text-xl font-semibold">
                {c.creditAccount
                  ? money(c.creditAccount.balanceAmount, c.creditAccount.currency)
                  : 'Not tracked'}
              </p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Credit added</p>
              <p className="mt-1 text-xl font-semibold">
                {c.creditAccount
                  ? money(c.creditAccount.lifetimeCreditAdded, c.creditAccount.currency)
                  : '-'}
              </p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">AI charged</p>
              <p className="mt-1 text-xl font-semibold">
                {c.creditAccount
                  ? money(c.creditAccount.lifetimeUsageCharged, c.creditAccount.currency)
                  : '-'}
              </p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Add-ons</p>
              <p className="mt-1 text-xl font-semibold">
                {c.addons.filter((addon) => addon.status === 'active').length}
              </p>
            </div>
          </div>

          <form
            action={topUpCompanyCreditAction}
            className="grid gap-3 rounded-md border bg-muted/20 p-3 sm:grid-cols-[160px_minmax(0,1fr)_auto]"
          >
            <input type="hidden" name="companyId" value={c.id} />
            <div className="space-y-1.5">
              <Label htmlFor="creditTopUpAmount">Top up (£)</Label>
              <Input
                id="creditTopUpAmount"
                name="amount"
                type="number"
                min={0.01}
                step="0.01"
                placeholder="10.00"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="creditTopUpDescription">Note</Label>
              <Input
                id="creditTopUpDescription"
                name="description"
                placeholder="Invoice paid, bonus credit, or manual adjustment"
              />
            </div>
            <div className="flex items-end">
              <Button type="submit" size="sm">
                Add credit
              </Button>
            </div>
          </form>

          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-semibold">Recent credit movements</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {c.creditTransactions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                        No credit movements yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    c.creditTransactions.map((tx) => (
                      <TableRow key={tx.id}>
                        <TableCell>{tx.description ?? tx.type}</TableCell>
                        <TableCell>{money(tx.amount, tx.currency)}</TableCell>
                        <TableCell>{formatDate(tx.createdAt)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold">Charges and add-ons</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    ...c.addons.map((addon) => ({
                      key: addon.key,
                      item: addon.label,
                      amount: money(addon.priceMonthly, addon.currency) + '/mo',
                      status: addon.status,
                    })),
                    ...c.commercialCharges.map((charge) => ({
                      key: `${charge.chargeType}-${charge.createdAt}`,
                      item: charge.description ?? charge.chargeType,
                      amount: money(charge.amount, charge.currency),
                      status: charge.status,
                    })),
                  ].length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                        No commercial charges recorded.
                      </TableCell>
                    </TableRow>
                  ) : (
                    [
                      ...c.addons.map((addon) => ({
                        key: addon.key,
                        item: addon.label,
                        amount: money(addon.priceMonthly, addon.currency) + '/mo',
                        status: addon.status,
                      })),
                      ...c.commercialCharges.map((charge) => ({
                        key: `${charge.chargeType}-${charge.createdAt}`,
                        item: charge.description ?? charge.chargeType,
                        amount: money(charge.amount, charge.currency),
                        status: charge.status,
                      })),
                    ].map((item) => (
                      <TableRow key={item.key}>
                        <TableCell>{item.item}</TableCell>
                        <TableCell>{item.amount}</TableCell>
                        <TableCell>{item.status}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Operator shortcuts</CardTitle>
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
              <Link href="/super-admin/quality">Platform quality</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/super-admin/usage">Usage and cost</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/super-admin/audit-logs">Audit logs</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Profile + status */}
        <Card>
          <CardHeader>
            <CardTitle>Profile & status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Country" value={c.country ?? '—'} />
            <Row label="Default language" value={c.defaultLanguage} />
            <Row label="Created" value={formatDate(c.createdAt)} />
            <div className="pt-2">
              <form action={setCompanyStatusAction}>
                <input type="hidden" name="companyId" value={c.id} />
                <input type="hidden" name="status" value={isActive ? 'suspended' : 'active'} />
                <Button type="submit" variant={isActive ? 'destructive' : 'default'} size="sm">
                  {isActive ? 'Suspend company' : 'Activate company'}
                </Button>
              </form>
            </div>
          </CardContent>
        </Card>

        {/* Subscription */}
        <Card>
          <CardHeader>
            <CardTitle>Subscription & limits</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={updateSubscriptionAction} className="space-y-4">
              <input type="hidden" name="companyId" value={c.id} />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="plan">Plan</Label>
                  <select
                    id="plan"
                    name="plan"
                    className={selectCls}
                    defaultValue={sub.plan ?? 'free_trial'}
                  >
                    {billingPlans.map((plan) => (
                      <option key={plan.key} value={plan.key}>
                        {plan.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="status">Status</Label>
                  <select
                    id="status"
                    name="status"
                    className={selectCls}
                    defaultValue={sub.status ?? 'trialing'}
                  >
                    {SUBSCRIPTION_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="freeUntil">Free until</Label>
                  <Input
                    id="freeUntil"
                    name="freeUntil"
                    type="date"
                    defaultValue={sub.freeUntil ?? ''}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="messageLimit">Message limit</Label>
                  <Input
                    id="messageLimit"
                    name="messageLimit"
                    type="number"
                    min={1}
                    defaultValue={sub.messageLimit ?? ''}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="agentLimit">Agent limit</Label>
                  <Input
                    id="agentLimit"
                    name="agentLimit"
                    type="number"
                    min={0}
                    defaultValue={sub.agentLimit ?? ''}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="botLimit">Bot limit</Label>
                  <Input
                    id="botLimit"
                    name="botLimit"
                    type="number"
                    min={0}
                    defaultValue={sub.botLimit ?? ''}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="integrationLimit">Integration limit</Label>
                  <Input
                    id="integrationLimit"
                    name="integrationLimit"
                    type="number"
                    min={0}
                    defaultValue={sub.integrationLimit ?? ''}
                  />
                </div>
              </div>
              <Button type="submit" size="sm">
                Save changes
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Members */}
      <Card>
        <CardHeader>
          <CardTitle>Team</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {c.members.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                    No members.
                  </TableCell>
                </TableRow>
              ) : (
                c.members.map((m, i) => (
                  <TableRow key={i}>
                    <TableCell>{m.fullName ?? '—'}</TableCell>
                    <TableCell>{m.email ?? '—'}</TableCell>
                    <TableCell>{m.role}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Bots */}
      <Card>
        <CardHeader>
          <CardTitle>Assistants</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>AI</TableHead>
                <TableHead>Public bot ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {c.bots.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                    No assistants yet (created by the company admin — Module 6).
                  </TableCell>
                </TableRow>
              ) : (
                c.bots.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.name}</TableCell>
                    <TableCell>{b.botType}</TableCell>
                    <TableCell>{b.aiEnabled ? 'On' : 'Off'}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {b.publicBotId}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Assistant evaluation (super-admin only — scores are private) */}
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
          <p className="text-sm text-muted-foreground">
            Internal LLM-judged scores. Not shown to the company — they see actionable suggestions
            instead.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {!evalDetail ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              No graded run yet. Add sample questions (company side), then run a graded evaluation.
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
                {evalDetail.results.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                      No questions evaluated.
                    </TableCell>
                  </TableRow>
                ) : (
                  evalDetail.results.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="max-w-xs align-top font-medium">{r.question}</TableCell>
                      <TableCell>{r.score == null ? '—' : `${r.score}%`}</TableCell>
                      <TableCell>
                        <Badge variant={r.verdict === 'pass' ? 'success' : 'warning'}>
                          {r.verdict ?? '—'}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-xs text-muted-foreground">
                        {r.fix || r.rationale || '—'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Audit */}
      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {c.audits.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                    No activity recorded.
                  </TableCell>
                </TableRow>
              ) : (
                c.audits.map((a, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-muted-foreground">
                      {formatDate(a.createdAt)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{a.action}</TableCell>
                    <TableCell>{a.actorEmail ?? 'system'}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
