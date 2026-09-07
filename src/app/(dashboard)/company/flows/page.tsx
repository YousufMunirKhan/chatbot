import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ACTIVATION_STATUS_LABELS, CHANNEL_LABELS, ROLES, labelFor } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { ConfirmSubmit } from '@/components/confirm-submit';
import { formatDate } from '@/lib/format';
import { listFlows } from '@/modules/company/flows-data';
import {
  duplicateFlowAction,
  deleteFlowAction,
  toggleFlowStatusAction,
} from '@/modules/company/flows-actions';
import { describeTrigger, TRIGGER_TYPE_LABELS } from '@/modules/company/flow-graph';
import { FlowTemplateGrid, NewFlowForm } from '@/modules/company/components/flow-create';

export const dynamic = 'force-dynamic';

async function duplicate(formData: FormData) {
  'use server';
  await duplicateFlowAction(formData);
}
async function remove(formData: FormData) {
  'use server';
  await deleteFlowAction(formData);
}
async function setStatus(formData: FormData) {
  'use server';
  await toggleFlowStatusAction(formData);
}

/**
 * Badge tone per flow status. The WORDS come from `ACTIVATION_STATUS_LABELS` in
 * `src/lib/constants.ts` — the same map chat invites and automatic messages use
 * — so the same stored value cannot read "Live" here and "Switched on" there.
 * Only the colour is local, because only the colour is local knowledge.
 */
const STATUS_TONE: Record<string, 'success' | 'warning' | 'outline'> = {
  live: 'success',
  paused: 'warning',
  draft: 'outline',
};

export default async function FlowsPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const flows = await listFlows();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Guided chats"
        description="For the conversations you want to go the same way every time — a booking, a menu, taking someone’s details. You write the questions and the assistant asks them in order, instead of deciding for itself."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/company/intents">Trigger phrases</Link>
          </Button>
        }
      />

      {/* Desktop: the guided chats you already have on the left, the two
          ways to start a new one on the right. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <div className="space-y-6">
          <Card>
            <CardContent className="p-0">
              {flows.length === 0 ? (
                <EmptyState
                  title="You have no guided chats yet"
                  body="Right now every message goes straight to the assistant, which decides for itself what to say. A guided chat lets you script the conversations that should always go the same way, and hands anything else back to the assistant. Start from one of the templates beside this."
                  action={
                    <Button asChild size="sm">
                      <a href="#templates">Start from a template</a>
                    </Button>
                  }
                />
              ) : (
                <ul className="divide-y">
                  {flows.map((flow) => {
                    const tone = STATUS_TONE[flow.status] ?? 'outline';
                    const activeTriggers = flow.triggers.filter((t) => t.isActive);
                    return (
                      <li key={flow.id} className="space-y-3 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Link
                                href={`/company/flows/${flow.id}`}
                                className="font-medium hover:underline"
                              >
                                {flow.name}
                              </Link>
                              <Badge variant={tone}>
                                {labelFor(ACTIVATION_STATUS_LABELS, flow.status)}
                              </Badge>
                              <Badge variant="outline">
                                {flow.blockCount} {flow.blockCount === 1 ? 'block' : 'blocks'}
                              </Badge>
                              {flow.channels.length === 0 ? (
                                <Badge variant="outline">Every channel</Badge>
                              ) : (
                                flow.channels.map((c) => (
                                  <Badge key={c} variant="info">
                                    {labelFor(CHANNEL_LABELS, c)}
                                  </Badge>
                                ))
                              )}
                            </div>
                            {flow.description ? (
                              <p className="text-sm text-muted-foreground">{flow.description}</p>
                            ) : null}
                            <p className="text-xs text-muted-foreground">
                              {activeTriggers.length === 0
                                ? 'No active trigger yet — this flow will never start on its own.'
                                : describeTrigger(activeTriggers[0]!)}
                              {activeTriggers.length > 1
                                ? ` +${activeTriggers.length - 1} more trigger${activeTriggers.length > 2 ? 's' : ''}`
                                : ''}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Version {flow.version} · edited {formatDate(flow.updatedAt)}
                            </p>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <Button asChild size="sm">
                              <Link href={`/company/flows/${flow.id}`}>Edit</Link>
                            </Button>
                            <form action={setStatus}>
                              <input type="hidden" name="id" value={flow.id} />
                              <input
                                type="hidden"
                                name="status"
                                value={flow.status === 'live' ? 'paused' : 'live'}
                              />
                              <Button type="submit" size="sm" variant="outline">
                                {flow.status === 'live'
                                  ? 'Take this off my website'
                                  : 'Put this live'}
                              </Button>
                            </form>
                            <form action={duplicate}>
                              <input type="hidden" name="id" value={flow.id} />
                              <Button type="submit" size="sm" variant="outline">
                                Make a copy
                              </Button>
                            </form>
                            <form action={remove}>
                              <input type="hidden" name="id" value={flow.id} />
                              <ConfirmSubmit
                                label="Delete"
                                question="Conversations already inside this flow will stop."
                              />
                            </form>
                          </div>
                        </div>

                        {flow.triggers.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {flow.triggers.map((t) => (
                              <Badge
                                key={t.id}
                                variant={t.isActive ? 'secondary' : 'outline'}
                                title={describeTrigger(t)}
                              >
                                {TRIGGER_TYPE_LABELS[t.type]}
                                {t.matchValue ? `: ${t.matchValue}` : ''}
                                {t.isActive ? '' : ' (off)'}
                              </Badge>
                            ))}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sticky on desktop: you fill this in while reading the list
            beside it, so it must not scroll away with that list. */}
        <div className="space-y-6 lg:sticky lg:top-6 lg:self-start">
          <Card id="templates">
            <CardHeader>
              <CardTitle>Start from a template</CardTitle>
              <CardDescription>
                Each template creates a complete, working flow — wired end to end and ready to
                publish. Open it and change the wording to match your business.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FlowTemplateGrid />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Or start from nothing</CardTitle>
              <CardDescription>A Start block and one message. You wire the rest.</CardDescription>
            </CardHeader>
            <CardContent>
              <NewFlowForm />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
