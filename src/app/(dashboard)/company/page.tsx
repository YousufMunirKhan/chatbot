import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { getCompanyDashboardSummary, type MetricTrend } from '@/modules/company/dashboard-data';
import { getCompanySetupProgress, type CompanySetupProgress } from '@/modules/company/setup-data';
import { formatNumber } from '@/lib/format';
import { RefreshOnFocus } from '@/components/refresh-on-focus';

/**
 * Company home.
 *
 * This page is a state machine, not a dashboard. It renders exactly one of four
 * states, and each state asks for exactly one thing:
 *
 *   A  — no assistant yet          → make one
 *   B  — setup in progress         → do the next step
 *   C1 — live, no traffic yet      → try it, check the website
 *   C2 — live with traffic         → reply to whoever is waiting
 *
 * Rules the rebuild holds to: at most one solid-variant Button per state (in C2
 * with an empty queue there is nothing to push, so the inbox becomes a quiet
 * link), no status badge in the header, no lifetime counters, no readiness
 * percentage, and no plan or billing chrome — those live on their own screens.
 */

/**
 * Imperative, owner-voice call to action for each setup step. The step titles
 * describe the job; these describe the click.
 */
const STEP_CTA: Record<string, string> = {
  purpose: 'Choose what it does',
  capabilities: 'Pick the jobs',
  'required-data': 'Add my details',
  test: 'Try it now',
  install: 'Get my website code',
};

function trendLabel(trend: MetricTrend): string {
  if (trend.change === 0) return 'Same as last week';
  const direction = trend.change > 0 ? '+' : '−';
  return `${direction}${formatNumber(Math.abs(trend.change))} vs last week`;
}

function SignalTile({ label, trend }: { label: string; trend: MetricTrend }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-3xl font-semibold tabular-nums">{formatNumber(trend.current)}</p>
        <p className="mt-1 text-xs text-muted-foreground">{trendLabel(trend)}</p>
      </CardContent>
    </Card>
  );
}

/** Plain, non-interactive tiles. State A shows what they get, not what they lack. */
function FeatureTile({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

/** A five-dot rail. Progress only — no percentage, and nothing here is a link. */
function StepRail({ setup }: { setup: CompanySetupProgress }) {
  const currentKey = setup.nextStep?.key;
  return (
    <ol className="flex flex-wrap gap-2">
      {setup.steps.map((step, index) => {
        const isCurrent = step.key === currentKey;
        return (
          <li
            key={step.key}
            aria-current={isCurrent ? 'step' : undefined}
            className={[
              'flex items-center gap-2 rounded-full border px-3 py-1 text-xs',
              step.complete
                ? 'border-success-border bg-success-bg text-success-fg'
                : isCurrent
                  ? 'border-foreground/30 font-medium'
                  : 'text-muted-foreground',
            ].join(' ')}
          >
            <span aria-hidden="true" className="tabular-nums">
              {step.complete ? '✓' : index + 1}
            </span>
            <span>{step.title}</span>
          </li>
        );
      })}
    </ol>
  );
}

export default async function CompanyOverview() {
  const [summary, setup] = await Promise.all([
    getCompanyDashboardSummary(),
    getCompanySetupProgress(),
  ]);

  const hasAssistant = setup.steps.find((step) => step.key === 'purpose')?.complete ?? false;
  const isLive = setup.steps.find((step) => step.key === 'install')?.complete ?? false;
  const nextStep = setup.nextStep;
  const stepNumber = nextStep ? setup.steps.findIndex((step) => step.key === nextStep.key) + 1 : 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <RefreshOnFocus />

      <PageHeader title={summary.company.name} />

      {/* ------------------------------------------------------------------ */}
      {/* State A — no assistant yet. No stats: zeroes are demoralising.      */}
      {/* ------------------------------------------------------------------ */}
      {!hasAssistant ? (
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-4 p-6">
              <h2 className="text-lg font-semibold">Set up your assistant</h2>
              <p className="max-w-xl text-sm text-muted-foreground">
                It answers your customers on your website day and night, takes their details while you are busy,
                and passes anything it cannot answer straight to you.
              </p>
              <Button asChild size="lg">
                <Link href={nextStep?.href ?? '/company/bots/new'}>Set up my assistant</Link>
              </Button>
            </CardContent>
          </Card>
          <div className="grid gap-3 sm:grid-cols-3">
            <FeatureTile
              title="It answers questions"
              body="Opening hours, prices, delivery, returns — in your own words, from what you tell it."
            />
            <FeatureTile
              title="It takes details"
              body="Names, numbers and what the customer wanted, ready for you to follow up."
            />
            <FeatureTile
              title="It hands over to you"
              body="Anything it cannot answer lands in your inbox with the whole conversation."
            />
          </div>
        </div>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* State B — setup in progress. The next step is the whole page.       */}
      {/* ------------------------------------------------------------------ */}
      {hasAssistant && !isLive && nextStep ? (
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-4 p-6">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Step {stepNumber} of {setup.total}
              </p>
              <h2 className="text-lg font-semibold">{nextStep.title}</h2>
              <p className="max-w-xl text-sm text-muted-foreground">{nextStep.description}</p>
              <Button asChild size="lg">
                <Link href={nextStep.href}>{STEP_CTA[nextStep.key] ?? 'Continue'}</Link>
              </Button>
            </CardContent>
          </Card>
          <StepRail setup={setup} />
        </div>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* State C1 — live, but nobody has chatted this week.                  */}
      {/* ------------------------------------------------------------------ */}
      {isLive && summary.conversations7d.current === 0 ? (
        <Card>
          <CardContent className="space-y-4 p-6">
            <h2 className="text-lg font-semibold">Your assistant is live</h2>
            <p className="max-w-xl text-sm text-muted-foreground">
              Nobody has chatted this week. That is normal in the first few days — the chat only opens when
              someone on your website clicks it.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <Button asChild size="lg">
                <Link href="/company/widget#test-assistant">Ask it a question</Link>
              </Button>
              <Link href="/company/widget" className="text-sm underline underline-offset-4">
                Check my website
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* State C2 — the steady state.                                        */}
      {/* ------------------------------------------------------------------ */}
      {isLive && summary.conversations7d.current > 0 ? (
        <div className="space-y-6">
          <Card>
            <CardContent className="space-y-4 p-6">
              {summary.needsReply > 0 ? (
                <>
                  <h2 className="text-xl font-semibold">
                    {summary.needsReply === 1
                      ? '1 person is waiting for you'
                      : `${formatNumber(summary.needsReply)} people are waiting for you`}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Your assistant could not finish these on its own.
                  </p>
                  <Button asChild size="lg">
                    <Link href="/company/inbox">Open the inbox</Link>
                  </Button>
                </>
              ) : (
                <>
                  <h2 className="text-xl font-semibold">Nothing is waiting for you</h2>
                  <p className="text-sm text-muted-foreground">
                    Your assistant has handled every chat so far.{' '}
                    <Link href="/company/inbox" className="underline underline-offset-4">
                      Open the inbox
                    </Link>
                    .
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-3 sm:grid-cols-3">
            <SignalTile label="Chats this week" trend={summary.conversations7d} />
            <SignalTile label="Answered on its own" trend={summary.answeredByAi7d} />
            <SignalTile label="New enquiries" trend={summary.newCustomerWork7d} />
          </div>

          {summary.unansweredQuestions.length > 0 ? (
            <Card>
              <CardContent className="space-y-3 p-6">
                <div>
                  <h2 className="text-base font-semibold">Questions it could not answer</h2>
                  <p className="text-sm text-muted-foreground">
                    Customers asked these and your assistant had nothing to go on. Tell it the answer once and it
                    will handle them from now on.
                  </p>
                </div>
                <ul className="divide-y rounded-lg border">
                  {summary.unansweredQuestions.map((item) => (
                    <li
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-3 p-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{item.question}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.timesAsked === 1 ? 'Asked once this week' : `Asked ${item.timesAsked} times this week`}
                        </p>
                      </div>
                      <Button asChild variant="outline" size="sm">
                        <Link href="/company/business-data?tab=knowledge">Answer this</Link>
                      </Button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
