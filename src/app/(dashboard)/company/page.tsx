import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getCompanyOverview } from '@/modules/company/data';
import { getCompanySetupProgress } from '@/modules/company/setup-data';
import { listConversations } from '@/modules/company/inbox-data';
import { listLeads } from '@/modules/company/leads-data';
import { listAppointments } from '@/modules/company/appointments-data';
import { listChatOrders, listSyncedOrders } from '@/modules/company/orders-data';
import { planLabel } from '@/modules/super-admin/plans';
import { formatDate, formatNumber } from '@/lib/format';

function Stat({ label, value, href }: { label: string; value: string; href?: string }) {
  const body = (
    <Card className={href ? 'transition-colors hover:bg-muted/50' : undefined}>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
        <div className="mt-1 text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export default async function CompanyOverview() {
  const [o, setup, conversations, leads, appointments, chatOrders, syncedOrders] = await Promise.all([
    getCompanyOverview(),
    getCompanySetupProgress(),
    listConversations(),
    listLeads(),
    listAppointments(),
    listChatOrders(),
    listSyncedOrders(),
  ]);
  const sub = o.company.subscription;
  const activeConversations = conversations.filter((c) => c.status !== 'closed').length;
  const customerWork = leads.length + appointments.length + chatOrders.length + syncedOrders.length;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{o.company.name}</h1>
          <p className="text-sm text-muted-foreground">
            {planLabel(sub.plan)} plan
            {sub.freeUntil ? `, free until ${formatDate(sub.freeUntil)}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={o.company.status === 'active' ? 'success' : 'destructive'}>
            {o.company.status}
          </Badge>
          <Button asChild>
            <Link href={setup.nextStep?.href ?? '/company/widget'}>
              {setup.nextStep ? `Continue setup` : 'Test widget'}
            </Link>
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="grid gap-0 p-0 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-4 p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">Assistant launch readiness</p>
                <p className="text-sm text-muted-foreground">
                  {setup.nextStep ? `Next: ${setup.nextStep.title}` : 'Ready to keep improving'}
                </p>
              </div>
              <Badge variant={setup.percent >= 80 ? 'success' : setup.percent >= 50 ? 'warning' : 'secondary'}>
                {setup.percent}% ready
              </Badge>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${setup.percent}%` }} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link href="/company/setup">Open setup journey</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/company/business-data">Improve business data</Link>
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 border-t bg-muted/30 lg:border-l lg:border-t-0">
            <div className="border-b border-r p-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Assistants</p>
              <p className="mt-1 text-2xl font-semibold">{formatNumber(o.botCount)}</p>
            </div>
            <div className="border-b p-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Team</p>
              <p className="mt-1 text-2xl font-semibold">{formatNumber(o.memberCount)}</p>
            </div>
            <div className="border-r p-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Open chats</p>
              <p className="mt-1 text-2xl font-semibold">{formatNumber(activeConversations)}</p>
            </div>
            <div className="p-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Customer work</p>
              <p className="mt-1 text-2xl font-semibold">{formatNumber(customerWork)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Inbox" value={formatNumber(activeConversations)} href="/company/inbox" />
        <Stat label="Customers" value={formatNumber(customerWork)} href="/company/customers" />
        <Stat
          label="Message limit"
          value={sub.messageLimit == null ? 'Unlimited' : formatNumber(sub.messageLimit)}
          href="/company/usage"
        />
        <Stat label="Business data" value={`${setup.stats.businessReadiness}%`} href="/company/business-data" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Next actions</CardTitle>
            <Link href="/company/setup" className="text-sm text-primary hover:underline">View setup</Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {setup.steps.slice(0, 4).map((step) => (
              <div key={step.key} className="flex items-center justify-between gap-3 rounded-md border p-3">
                <div>
                  <p className="text-sm font-medium">{step.title}</p>
                  <p className="text-xs text-muted-foreground">{step.detail}</p>
                </div>
                <Button asChild variant={step.complete ? 'outline' : 'default'} size="sm">
                  <Link href={step.href}>{step.complete ? 'Update' : 'Start'}</Link>
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Daily workspace</CardTitle>
            <Link href="/company/inbox" className="text-sm text-primary hover:underline">Open inbox</Link>
          </CardHeader>
          <CardContent className="space-y-3">
            <Link href="/company/inbox" className="flex items-center justify-between rounded-md border p-3 hover:bg-muted/50">
              <span className="text-sm font-medium">Reply to active conversations</span>
              <Badge>{activeConversations}</Badge>
            </Link>
            <Link href="/company/customers" className="flex items-center justify-between rounded-md border p-3 hover:bg-muted/50">
              <span className="text-sm font-medium">Review customer requests</span>
              <Badge variant="secondary">{customerWork}</Badge>
            </Link>
            <Link href="/company/widget" className="flex items-center justify-between rounded-md border p-3 hover:bg-muted/50">
              <span className="text-sm font-medium">Test or install widget</span>
              <span className="text-sm text-muted-foreground">Open</span>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
