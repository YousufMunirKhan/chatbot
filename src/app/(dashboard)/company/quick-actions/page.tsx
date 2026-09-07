import { BarChart3, CalendarDays, MessageSquare } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { requireRole } from '@/lib/auth';
import {
  ROLES,
  ACTIVATION_STATUS_LABELS,
  QUICK_ACTION_AUDIENCE_LABELS,
  QUICK_ACTION_CONTEXT_LABELS,
  QUICK_ACTION_MOMENT_LABELS,
  QUICK_ACTION_SOURCE_LABELS,
  QUICK_ACTION_TYPE_LABELS,
  labelFor,
} from '@/lib/constants';
import { QuickActionForm } from '@/modules/company/components/quick-action-form';
import { deleteQuickActionAction } from '@/modules/company/quick-actions-actions';
import { listQuickActions } from '@/modules/company/quick-actions-data';
import { ConfirmSubmit } from '@/components/confirm-submit';

/**
 * Every label on this page now comes from the shared `QUICK_ACTION_*` maps.
 * This file used to keep its own four maps and its own humaniser, and the
 * builder below kept a fifth set, so one stored value read two different ways
 * depending on which screen you were on — `send_message` was "Message" here and
 * "Send message" in the form.
 */
function moments(values: string[]): string {
  // An empty `contexts` array is not "untargeted" — the widget treats it as
  // matching every moment, so say that rather than implying it is switched off.
  if (!values.length) return 'Shown at every moment in the chat';
  return values.map((value) => labelFor(QUICK_ACTION_MOMENT_LABELS, value)).join(', ');
}

export default async function QuickActionsPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const { actions, bots } = await listQuickActions();
  const botName = new Map(bots.map((bot) => [bot.id, bot.name]));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Chat buttons"
        description="The buttons a customer can tap in the chat instead of typing — “Book a table”, “What does it cost?”, “Talk to a person”. Give people something to press and far more of them start a conversation."
        actions={
          <Button asChild variant="outline">
            <a href="/company/quick-actions/analytics">
              <BarChart3 className="me-2 h-4 w-4" aria-hidden="true" />
              See how they are doing
            </a>
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border bg-card p-4">
          <div className="text-sm font-semibold">1. Pick what it does</div>
          <p className="mt-1 text-sm text-muted-foreground">
            Send a message, give an answer, ask for details, open a link, ring you, or fetch a
            person.
          </p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-sm font-semibold">2. Fill in the few boxes</div>
          <p className="mt-1 text-sm text-muted-foreground">
            You are only asked for what that particular kind of button needs.
          </p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-sm font-semibold">3. See it before you save</div>
          <p className="mt-1 text-sm text-muted-foreground">
            The preview shows exactly how it will look in your website chat.
          </p>
        </div>
      </div>

      <Card id="create-quick-action">
        <CardHeader>
          <CardTitle className="text-base">Make a chat button</CardTitle>
        </CardHeader>
        <CardContent>
          <QuickActionForm bots={bots} />
        </CardContent>
      </Card>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Your chat buttons</h2>
          <p className="text-sm text-muted-foreground">
            These are showing in your chat right now. Change or remove any of them here.
          </p>
        </div>

        {actions.length ? (
          <div className="space-y-3">
            {actions.map((action) => (
              <Card key={action.id}>
                <CardHeader className="flex-row items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="text-base">{action.label}</CardTitle>
                      <Badge variant={action.isActive ? 'success' : 'secondary'}>
                        {labelFor(
                          ACTIVATION_STATUS_LABELS,
                          action.isActive ? 'active' : 'disabled',
                        )}
                      </Badge>
                      <Badge variant="outline">
                        {labelFor(QUICK_ACTION_TYPE_LABELS, action.actionType)}
                      </Badge>
                      <Badge variant="outline">
                        {labelFor(QUICK_ACTION_AUDIENCE_LABELS, action.audience)}
                      </Badge>
                      <Badge variant="secondary">
                        {labelFor(QUICK_ACTION_SOURCE_LABELS, action.source)}
                      </Badge>
                      <Badge variant="outline">
                        {labelFor(QUICK_ACTION_CONTEXT_LABELS, action.contextMode)}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {botName.get(action.botId ?? '') ?? 'All assistants'} ·{' '}
                      {moments(action.contexts)}
                    </p>
                  </div>
                  <form action={deleteQuickActionAction}>
                    <input type="hidden" name="id" value={action.id} />
                    {/* The visible label names the button being removed: a list
                        of identical "Delete" controls gives a screen-reader
                        user no way to tell which one they are on. */}
                    <ConfirmSubmit
                      label={`Delete “${action.label}”`}
                      question="This button stops appearing in your chat straight away."
                    />
                  </form>
                </CardHeader>
                <CardContent>
                  <details className="rounded-lg border bg-muted/20 p-3">
                    <summary className="cursor-pointer text-sm font-medium">
                      Edit this chat button
                    </summary>
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
            <CardContent className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-center [&>*]:min-w-0">
              {/* Module 1 — the builder is on this page, so link straight to it. */}
              <div>
                <h3 className="text-lg font-semibold">No chat buttons yet</h3>
                <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                  Right now a visitor opens the chat and sees an empty box with nothing to tap, and
                  most of them close it again. Add one button for the thing people most often want —
                  booking, prices, or talking to you. The example on the right is how it will look.
                </p>
                <Button asChild size="sm" className="mt-4">
                  <a href="#create-quick-action">Make my first chat button</a>
                </Button>
              </div>
              <div className="rounded-xl border bg-slate-950 p-4 text-white">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <MessageSquare className="h-4 w-4 text-emerald-300" aria-hidden="true" />
                  How it would look
                </div>
                <div className="rounded-xl bg-white p-3 text-slate-950">
                  <p className="mb-3 text-sm text-slate-600">Hi! How can I help?</p>
                  <button
                    type="button"
                    disabled
                    className="inline-flex cursor-not-allowed items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white opacity-80"
                  >
                    <CalendarDays className="h-4 w-4" aria-hidden="true" />
                    Book a free demo
                  </button>
                  <p className="mt-2 text-xs text-slate-500">An example — this one does nothing</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
