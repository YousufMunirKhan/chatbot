import { BarChart3, CalendarDays, MessageSquare } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { QuickActionForm } from '@/modules/company/components/quick-action-form';
import { deleteQuickActionAction } from '@/modules/company/quick-actions-actions';
import { listQuickActions } from '@/modules/company/quick-actions-data';

const TYPE_LABELS: Record<string, string> = {
  send_message: 'Message',
  direct_answer: 'Answer',
  lead_form: 'Lead form',
  appointment_form: 'Appointment',
  external_link: 'Link',
  product_link: 'Product',
  whatsapp: 'WhatsApp',
  phone_call: 'Call',
  request_human: 'Human handoff',
  tool_action: 'Tool',
};

function prettyList(values: string[]) {
  if (!values.length) return 'Not targeted';
  return values
    .map((value) =>
      value
        .split('_')
        .map((part) => part[0]?.toUpperCase() + part.slice(1))
        .join(' '),
    )
    .join(', ');
}

export default async function QuickActionsPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const { actions, bots } = await listQuickActions();
  const botName = new Map(bots.map((bot) => [bot.id, bot.name]));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-semibold">Quick Actions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create helpful chat buttons like Book demo, Ask pricing, Request support, or Talk to human.
          </p>
        </div>
        <Button asChild variant="outline">
          <a href="/company/quick-actions/analytics">
            <BarChart3 className="mr-2 h-4 w-4" />
            Analytics
          </a>
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border bg-white p-4">
          <div className="text-sm font-semibold">1. Choose action</div>
          <p className="mt-1 text-sm text-muted-foreground">Pick message, answer, form, link, call, or handoff.</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <div className="text-sm font-semibold">2. Fill only what matters</div>
          <p className="mt-1 text-sm text-muted-foreground">The builder changes based on the selected action type.</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <div className="text-sm font-semibold">3. Preview before saving</div>
          <p className="mt-1 text-sm text-muted-foreground">See how the pill will look in the website chat.</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create quick action</CardTitle>
        </CardHeader>
        <CardContent>
          <QuickActionForm bots={bots} />
        </CardContent>
      </Card>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Existing quick actions</h2>
          <p className="text-sm text-muted-foreground">Manage the pills already available in the chat widget.</p>
        </div>

        {actions.length ? (
          <div className="space-y-3">
            {actions.map((action) => (
              <Card key={action.id}>
                <CardHeader className="flex-row items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="text-base">{action.label}</CardTitle>
                      <Badge variant={action.isActive ? 'success' : 'secondary'}>{action.isActive ? 'Active' : 'Off'}</Badge>
                      <Badge variant="outline">{TYPE_LABELS[action.actionType] ?? action.actionType}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {botName.get(action.botId ?? '') ?? 'All assistants'} - {prettyList(action.contexts)}
                    </p>
                  </div>
                  <form action={deleteQuickActionAction}>
                    <input type="hidden" name="id" value={action.id} />
                    <Button type="submit" variant="outline" size="sm">Delete</Button>
                  </form>
                </CardHeader>
                <CardContent>
                  <details className="rounded-lg border bg-muted/20 p-3">
                    <summary className="cursor-pointer text-sm font-medium">Edit this quick action</summary>
                    <div className="mt-4">
                      <QuickActionForm bots={bots} action={action} compact />
                    </div>
                  </details>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="grid gap-6 p-6 lg:grid-cols-[1fr_340px] lg:items-center">
              <div>
                <h3 className="text-lg font-semibold">No quick actions yet</h3>
                <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                  Start with one high-intent action like booking a demo, asking for pricing, or requesting a human agent.
                  The disabled example shows how it will look to visitors.
                </p>
              </div>
              <div className="rounded-xl border bg-slate-950 p-4 text-white">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <MessageSquare className="h-4 w-4 text-emerald-300" />
                  Chat preview
                </div>
                <div className="rounded-xl bg-white p-3 text-slate-950">
                  <p className="mb-3 text-sm text-slate-600">Hi! How can I help?</p>
                  <button type="button" disabled className="inline-flex cursor-not-allowed items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white opacity-80">
                    <CalendarDays className="h-4 w-4" />
                    Book a free demo
                  </button>
                  <p className="mt-2 text-xs text-slate-500">Disabled demo pill</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
