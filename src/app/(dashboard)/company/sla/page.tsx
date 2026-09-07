import { requireRole } from '@/lib/auth';
import { CHANNEL_LABELS, PRIORITY_LABELS, ROLES, humanizeToken } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile } from '@/components/ui/stat-tile';
import { ConfirmSubmit } from '@/components/confirm-submit';
import { formatDate } from '@/lib/format';
import {
  getSlaPerformance,
  listEscalationTargets,
  listRecentSlaBreaches,
  listSlaPolicies,
} from '@/modules/company/sla-data';
import {
  deleteSlaPolicyAction,
  seedDefaultSlaPoliciesAction,
  toggleSlaPolicyAction,
} from '@/modules/company/sla-actions';
import { SlaPolicyForm } from '@/modules/company/components/sla-policy-form';

export const dynamic = 'force-dynamic';

async function toggle(formData: FormData) {
  'use server';
  await toggleSlaPolicyAction(formData);
}
async function remove(formData: FormData) {
  'use server';
  await deleteSlaPolicyAction(formData);
}
async function seed() {
  'use server';
  await seedDefaultSlaPoliciesAction();
}

const CHANNEL_OPTIONS = [
  'web_chat',
  'whatsapp',
  'instagram',
  'facebook',
  'telegram',
  'viber',
  'line',
  'email',
].map((value) => ({ value, label: CHANNEL_LABELS[value] ?? value }));

const BREACH_LABELS: Record<string, string> = {
  breached_response: 'Missed first response',
  breached_resolution: 'Missed resolution',
  escalated: 'Escalated',
};

function describeTarget(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${hours} h`;
}

export default async function SlaPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const [policies, performance, breaches, members] = await Promise.all([
    listSlaPolicies(),
    getSlaPerformance(30),
    listRecentSlaBreaches(15),
    listEscalationTargets(),
  ]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Reply-time targets"
        description="How fast you promise to get back to people. Set a target and we warn you before a chat goes past it, so nobody is left waiting without you knowing."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Answered in time (last 30 days)"
          value={`${performance.attainment}%`}
          hint={`Out of ${performance.tracked} chats with a target on them`}
          tone={
            performance.attainment >= 90
              ? 'success'
              : performance.attainment >= 75
                ? 'warning'
                : 'danger'
          }
        />
        <StatTile
          label="Usual time to first reply"
          value={
            performance.medianResponseMinutes === null
              ? '—'
              : describeTarget(performance.medianResponseMinutes)
          }
          hint={`Half of your ${performance.responded} answered chats were quicker than this`}
        />
        <StatTile
          label="Missed your target"
          value={performance.responseBreaches + performance.resolutionBreaches}
          hint={`${performance.responseBreaches} slow to reply · ${performance.resolutionBreaches} slow to finish`}
          tone={
            performance.responseBreaches + performance.resolutionBreaches > 0 ? 'danger' : 'default'
          }
        />
        <StatTile
          label="About to be late"
          value={performance.atRisk}
          hint="Needs an answer in the next 15 minutes"
          tone={performance.atRisk > 0 ? 'warning' : 'default'}
          href="/company/inbox"
        />
      </div>

      {/* Desktop: the list of targets you already have, beside the form that
          adds another. They were stacked, so on a 1440px screen you scrolled
          past your own rules to reach the form that copies one of them — and
          then could no longer see what you were copying. `min-w-0` on the
          children because a long policy name in a `1fr` track would otherwise
          stretch it and push the page sideways. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Your targets</CardTitle>
              <CardDescription>
                You can have one target for everything and then a tighter one for the cases that
                matter. The most specific one wins — a rule for urgent WhatsApp chats beats your
                general rule.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {policies.length === 0 ? (
                <EmptyState
                  title="No service levels yet"
                  body="Without a target, a conversation can sit unanswered and nobody is told. Start with the three most teams use, then adjust."
                  action={
                    <form action={seed}>
                      <Button type="submit" size="sm">
                        Create starter policies
                      </Button>
                    </form>
                  }
                />
              ) : (
                <ul className="divide-y">
                  {policies.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{p.name}</span>
                          <Badge variant={p.isActive ? 'success' : 'outline'}>
                            {p.isActive ? 'Active' : 'Paused'}
                          </Badge>
                          {p.appliesPriority ? (
                            <Badge variant="outline">
                              {PRIORITY_LABELS[p.appliesPriority] ??
                                humanizeToken(p.appliesPriority)}{' '}
                              only
                            </Badge>
                          ) : null}
                          {p.appliesChannel ? (
                            <Badge variant="outline">
                              {CHANNEL_LABELS[p.appliesChannel] ?? p.appliesChannel}
                            </Badge>
                          ) : null}
                          {p.businessHoursOnly ? (
                            <Badge variant="outline">While you are open</Badge>
                          ) : null}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Respond within {describeTarget(p.firstResponseMinutes)}
                          {p.resolutionMinutes
                            ? ` · resolve within ${describeTarget(p.resolutionMinutes)}`
                            : ''}
                          {p.escalateBeforeMinutes
                            ? ` · warn ${p.escalateBeforeMinutes} min before`
                            : ''}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <form action={toggle}>
                          <input type="hidden" name="id" value={p.id} />
                          <input type="hidden" name="active" value={(!p.isActive).toString()} />
                          <Button type="submit" size="sm" variant="outline">
                            {p.isActive ? 'Stop using this target' : 'Start using this target'}
                          </Button>
                        </form>
                        <form action={remove}>
                          <input type="hidden" name="id" value={p.id} />
                          <ConfirmSubmit
                            label="Delete this target"
                            question="Chats covered by this target stop being timed, and you will no longer be warned before one goes late. This cannot be undone."
                          />
                        </form>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Chats that went past their target</CardTitle>
              <CardDescription>
                Every conversation that passed its target in the last 30 days.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {breaches.length === 0 ? (
                <EmptyState
                  title="Nothing was late"
                  body="Every chat with a target on it was answered inside that target."
                />
              ) : (
                <ul className="divide-y text-sm">
                  {breaches.map((b, i) => (
                    <li
                      key={`${b.conversationId}-${i}`}
                      className="flex items-center justify-between gap-3 p-3"
                    >
                      <span>{BREACH_LABELS[b.event] ?? b.event}</span>
                      <span className="flex items-center gap-3">
                        <span className="text-muted-foreground">{formatDate(b.createdAt)}</span>
                        {b.conversationId ? (
                          <Button asChild size="sm" variant="outline">
                            <a href={`/company/inbox?conversation=${b.conversationId}`}>
                              Read the chat
                            </a>
                          </Button>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sticky on desktop: you refer back to the list on the left while you
            fill this in, so it must not scroll away with it. */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle>Add a target</CardTitle>
              <CardDescription>
                Leave a filter on &ldquo;Any&rdquo; to make this the fallback for everything else.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SlaPolicyForm channels={CHANNEL_OPTIONS} members={members} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
