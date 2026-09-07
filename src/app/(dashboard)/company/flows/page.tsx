import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ACTIVATION_STATUS_LABELS, CHANNEL_LABELS, ROLES, labelFor } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { UpgradeNotice } from '@/components/ui/upgrade-notice';
import { ConfirmSubmit } from '@/components/confirm-submit';
import { companyHasFeature, requireCompanyFeature } from '@/lib/entitlements';
import { formatDate } from '@/lib/format';
import { listFlows, type FlowListRow } from '@/modules/company/flows-data';
import {
  duplicateFlowAction,
  deleteFlowAction,
  toggleFlowStatusAction,
} from '@/modules/company/flows-actions';
import { describeTrigger, TRIGGER_TYPE_LABELS } from '@/modules/company/flow-graph';
import { FlowTemplateGrid, NewFlowForm } from '@/modules/company/components/flow-create';

export const dynamic = 'force-dynamic';

// The gate below decides what this page draws; these decide what a post can do.
// A form that is never rendered is still reachable with a crafted request.
async function duplicate(formData: FormData) {
  'use server';
  await requireCompanyFeature('flows');
  await duplicateFlowAction(formData);
}
async function remove(formData: FormData) {
  'use server';
  await requireCompanyFeature('flows');
  await deleteFlowAction(formData);
}
async function setStatus(formData: FormData) {
  'use server';
  await requireCompanyFeature('flows');
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

/** What a guided chat is, said once, in the order someone actually does it. */
const STEPS = [
  {
    title: 'Pick a starting point',
    body: 'A template gives you a complete, working flow. Nothing is a stub — you can publish it as it comes.',
  },
  {
    title: 'Change the wording',
    body: 'Open it in the builder and make the questions sound like your business. Add or remove steps as you go.',
  },
  {
    title: 'Choose when it starts',
    body: 'A trigger decides which messages open the flow. Until you set one, it sits as a draft and never runs.',
  },
];

export default async function FlowsPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  if (!(await companyHasFeature('flows'))) return <UpgradeNotice feature="flows" />;

  const flows = await listFlows();
  const hasFlows = flows.length > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Guided chats"
        description="Some conversations should go the same way every time — taking a booking, collecting someone’s details, answering the questions you get most. A guided chat asks your questions in the order you set them, instead of the assistant deciding for itself. Anything the flow does not cover is handed back to the assistant."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/company/intents">Trigger phrases</Link>
          </Button>
        }
      />

      {/* The page is laid out around what you have. With no flows, the templates
          ARE the task, so they get the full width — they used to be squeezed
          three-across into a sidebar roughly 130px per card, which broke the
          descriptions onto one word per line and clipped the buttons. With
          flows, the list is the task and creating another moves below it. */}
      {hasFlows ? (
        <>
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y">
                {flows.map((flow) => (
                  <FlowRow key={flow.id} flow={flow} />
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Add another guided chat</CardTitle>
              <CardDescription>
                Start from a template and change the wording, or build one from an empty canvas.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <FlowTemplateGrid />
              <div className="border-t pt-6">
                <p className="mb-3 text-sm font-medium">Or start from nothing</p>
                <div className="max-w-md">
                  <NewFlowForm />
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>How a guided chat works</CardTitle>
              <CardDescription>
                Right now every message goes straight to the assistant, which decides for itself
                what to say. Three steps change that for the conversations you want scripted.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="grid gap-4 sm:grid-cols-3">
                {STEPS.map((step, i) => (
                  <li key={step.title} className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold"
                      >
                        {i + 1}
                      </span>
                      <h3 className="text-sm font-semibold">{step.title}</h3>
                    </div>
                    <p className="text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Start from a template</CardTitle>
              <CardDescription>
                Each one creates a complete, working flow — wired end to end and ready to publish.
                Open it afterwards and change the wording to match your business.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FlowTemplateGrid />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Or start from nothing</CardTitle>
              <CardDescription>
                A Start block and one message. You wire the rest. Best once you have seen how a
                template is put together.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="max-w-md">
                <NewFlowForm />
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function FlowRow({ flow }: { flow: FlowListRow }) {
  const tone = STATUS_TONE[flow.status] ?? 'outline';
  const activeTriggers = flow.triggers.filter((t) => t.isActive);

  return (
    <li className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/company/flows/${flow.id}`} className="font-medium hover:underline">
              {flow.name}
            </Link>
            <Badge variant={tone}>{labelFor(ACTIVATION_STATUS_LABELS, flow.status)}</Badge>
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
            <input type="hidden" name="status" value={flow.status === 'live' ? 'paused' : 'live'} />
            <Button type="submit" size="sm" variant="outline">
              {flow.status === 'live' ? 'Take this off my website' : 'Put this live'}
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
}
