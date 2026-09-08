import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile } from '@/components/ui/stat-tile';
import {
  getCompanyDashboardSummary,
  type AttentionItem,
  type CompanyDashboardSummary,
  type MetricTrend,
} from '@/modules/company/dashboard-data';
import { getCompanySetupProgress, type CompanySetupProgress } from '@/modules/company/setup-data';
import {
  WebsitePrompt,
  type WebsitePromptLabels,
} from '@/modules/company/components/website-prompt';
import { formatDate, formatNumber } from '@/lib/format';
import { t, tOr, type Dictionary } from '@/lib/i18n';
import { getRequestDictionary } from '@/lib/i18n/server';
import { RefreshOnFocus } from '@/components/refresh-on-focus';

/**
 * Company home — the board a shop owner opens every morning.
 *
 * Before anything else it is still a state machine, because a tenant with no
 * assistant and a tenant with a full inbox need different pages, not the same
 * page with different numbers in it:
 *
 *   A  — no assistant yet                    → make one
 *   B  — setup in progress                   → do the next step
 *   C1 — live, nothing happening and nothing waiting → try it, check the website
 *   C2 — live, with traffic OR with a queue  → the board proper
 *
 * The C1/C2 split is on "is there anything to do or show", not on traffic
 * alone: an enquiry from three weeks ago that nobody rang back must not be
 * buried under a card saying nobody has chatted this week.
 *
 * State C2 answers three questions, in this order and no other:
 *
 *   1. WHAT NEEDS ME RIGHT NOW?  Every queue with something in it — chats past
 *      their reply-time target, chats waiting for a person, enquiries nobody
 *      contacted, automatic messages that failed. `attention` arrives already
 *      filtered to non-empty queues and sorted worst-first, so this section can
 *      never render a row of zeroes; if it is empty the page says so in a
 *      sentence instead.
 *   2. HOW IS IT GOING?  Four trailing-7-day numbers, each with a line saying
 *      what it counts and a week-over-week comparison. Nothing cumulative, and
 *      nothing derived from a number the owner cannot see for themselves.
 *   3. WHAT SHOULD I SET UP NEXT?  Only rendered while `setup.complete <
 *      setup.total`. A finished checklist removes the section rather than
 *      showing "5 of 5" forever.
 *
 * Rules the page holds to: exactly one solid-variant Button per state — in C2
 * that is the most urgent queue, and with every queue clear there is nothing to
 * push so the inbox becomes a quiet link — no status badge in the header, no
 * lifetime counters, no readiness percentage, and no plan or billing chrome.
 *
 * A signal that is always zero because the feature is switched off is worse
 * than no signal, so both places where that can happen link to the switch: SLA
 * and automation queues simply do not exist when their tables are empty, and
 * the rating tile becomes "turn on the star rating" rather than "—".
 */

/**
 * Imperative, owner-voice call to action for each setup step. The step titles
 * describe the job; these describe the click. Keyed by step, so the dictionary
 * (`home.cta.<step>`) carries the wording in both languages and an unknown step
 * falls back to a plain "Continue" rather than to a missing-key string.
 */
function stepCta(dict: Dictionary, key: string): string {
  const translated = t(dict, `home.cta.${key}`);
  return translated === `home.cta.${key}` ? t(dict, 'common.continue') : translated;
}

/**
 * The website prompt's copy, resolved here and handed over.
 *
 * `WebsitePrompt` is a client component — it owns the import form's state and a
 * "not now" that lives in the browser — and the dictionary is resolved on the
 * server from the company's `default_language`. So the strings are looked up on
 * this side and passed down, exactly as the shell passes `ShellLabels` to the
 * navigation rather than teaching it about `t()`.
 */
function websitePromptLabels(dict: Dictionary): WebsitePromptLabels {
  return {
    title: t(dict, 'home.website.title'),
    body: t(dict, 'home.website.body'),
    fieldLabel: t(dict, 'home.website.field'),
    fieldHint: t(dict, 'home.website.hint'),
    onFile: t(dict, 'home.website.on_file'),
    submit: t(dict, 'home.website.submit'),
    submitPending: t(dict, 'home.website.submitting'),
    dismiss: t(dict, 'home.website.dismiss'),
    dismissNote: t(dict, 'home.website.dismiss_note'),
    importedOne: t(dict, 'home.website.imported.one'),
    importedMany: t(dict, 'home.website.imported.many'),
    importedLink: t(dict, 'home.website.imported_link'),
    connectedTitle: t(dict, 'home.website.connected.title'),
    connectedBody: t(dict, 'home.website.connected.body'),
    refresh: t(dict, 'home.website.refresh'),
    refreshPending: t(dict, 'home.website.refreshing'),
  };
}

function trendLabel(dict: Dictionary, trend: MetricTrend): string {
  if (trend.change === 0) return t(dict, 'home.trend.same');
  return t(dict, 'home.trend.change', {
    direction: trend.change > 0 ? '+' : '−',
    value: formatNumber(Math.abs(trend.change)),
  });
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

/** A dot per setup step. Progress only — no percentage, and nothing is a link. */
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

/**
 * The headline for one queue, pluralised.
 *
 * Singular and plural are separate dictionary entries rather than one string
 * with an "(s)" in it, because Arabic does not pluralise the way English does
 * and "1 chats" is the kind of detail that makes a product feel unfinished.
 */
function attentionTitle(dict: Dictionary, item: AttentionItem): string {
  return item.count === 1
    ? t(dict, `home.attention.${item.key}.one`)
    : t(dict, `home.attention.${item.key}.many`, { count: formatNumber(item.count) });
}

/**
 * Question 1, the most urgent queue: the one thing on the page allowed a solid
 * button, sized so it is the first thing read.
 */
function LeadAttention({ item, dict }: { item: AttentionItem; dict: Dictionary }) {
  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        {/* `text-lg`, the dashboard's sub-heading size. `text-xl` is reserved
            for the marketing pages, and this heading was the only thing in the
            company panel using it — so the most important line on the busiest
            screen was set in a size that appears nowhere else in the product. */}
        <h2 className="text-lg font-semibold">{attentionTitle(dict, item)}</h2>
        <p className="text-sm text-muted-foreground">
          {t(dict, `home.attention.${item.key}.body`)}
        </p>
        <Button asChild size="lg">
          <Link href={item.href}>{t(dict, `home.attention.${item.key}.cta`)}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * Every other queue: a whole-tile link carrying its own count, so the owner can
 * see all four at a glance without four competing buttons. The count leads
 * because that is what decides whether it is worth opening now.
 */
function AttentionTile({ item, dict }: { item: AttentionItem; dict: Dictionary }) {
  return (
    <Link
      href={item.href}
      className="block rounded-lg border p-4 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <p className="text-2xl font-semibold tabular-nums">{formatNumber(item.count)}</p>
      <p className="mt-1 text-sm font-medium">{attentionTitle(dict, item)}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {t(dict, `home.attention.${item.key}.body`)}
      </p>
      <p className="mt-2 text-sm font-medium underline underline-offset-4">
        {t(dict, `home.attention.${item.key}.cta`)}
      </p>
    </Link>
  );
}

/**
 * Question 2. Four trailing-7-day numbers on `StatTile`, the shared tile — the
 * local `Stat` clone this page used to carry is exactly what that component was
 * extracted to replace.
 *
 * Each hint runs two lines on purpose: what the number counts, then how it
 * compares with last week. Without the first line "New customer requests" is
 * three different things added together and nobody can tell which.
 */
function WeekSignals({ summary, dict }: { summary: CompanyDashboardSummary; dict: Dictionary }) {
  const hint = (explanation: string, trend: MetricTrend) => (
    <>
      <span className="block">{explanation}</span>
      <span className="block">{trendLabel(dict, trend)}</span>
    </>
  );
  const csat = summary.csat7d;

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">{t(dict, 'home.week.title')}</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
        <StatTile
          label={t(dict, 'home.signal.chats')}
          value={formatNumber(summary.conversations7d.current)}
          hint={hint(t(dict, 'home.signal.chats.hint'), summary.conversations7d)}
        />
        <StatTile
          label={t(dict, 'home.signal.answered')}
          value={formatNumber(summary.answeredByAi7d.current)}
          hint={hint(t(dict, 'home.signal.answered.hint'), summary.answeredByAi7d)}
        />
        <StatTile
          label={t(dict, 'home.signal.enquiries')}
          value={formatNumber(summary.newCustomerWork7d.current)}
          hint={hint(t(dict, 'home.signal.enquiries.hint'), summary.newCustomerWork7d)}
          href="/company/customers"
        />
        {csat.responses > 0 && csat.average !== null ? (
          <StatTile
            label={t(dict, 'home.signal.rating')}
            value={`${csat.average.toFixed(1)} / 5`}
            hint={
              csat.responses === 1
                ? t(dict, 'home.signal.rating.one')
                : t(dict, 'home.signal.rating.many', { count: formatNumber(csat.responses) })
            }
            href="/company/reports"
          />
        ) : (
          /* No number to show, so no tile pretending there is one. If the
             rating was never switched on that is the owner's to fix and the
             card links straight at the switch; if it is on and simply unused
             this week, the card says that and asks for nothing. */
          <Card>
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                {t(dict, 'home.signal.rating')}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {csat.enabled ? t(dict, 'home.csat.none') : t(dict, 'home.csat.off')}
              </p>
              {csat.enabled ? null : (
                <Link
                  href="/company/widget"
                  className="mt-2 inline-block text-sm font-medium underline underline-offset-4"
                >
                  {t(dict, 'home.csat.off.link')}
                </Link>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </section>
  );
}

/**
 * Question 3, and only while there is an answer to it. Lives in the side column
 * on a wide screen: it is standing work, not today's work, so it must not
 * outrank the queue on the left.
 */
function FinishSetup({ setup, dict }: { setup: CompanySetupProgress; dict: Dictionary }) {
  const nextStep = setup.nextStep;
  if (!nextStep) return null;
  const remaining = setup.total - setup.complete;

  return (
    <Card>
      <CardContent className="space-y-3 p-6">
        <h2 className="text-base font-semibold">
          {remaining === 1
            ? t(dict, 'home.finish.one')
            : t(dict, 'home.finish.many', { count: formatNumber(remaining) })}
        </h2>
        <p className="text-sm text-muted-foreground">{t(dict, 'home.finish.body')}</p>
        <div>
          <p className="text-sm font-medium">{nextStep.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{nextStep.description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Button asChild variant="outline">
            <Link href={nextStep.href}>{stepCta(dict, nextStep.key)}</Link>
          </Button>
          <Link href="/company/setup" className="text-sm underline underline-offset-4">
            {t(dict, 'home.finish.link')}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

/** Real questions with no answer saved. Actionable, so it stays on the board. */
function UnansweredQuestions({
  summary,
  dict,
}: {
  summary: CompanyDashboardSummary;
  dict: Dictionary;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 p-6">
        <div>
          <h2 className="text-base font-semibold">{t(dict, 'home.unanswered.title')}</h2>
          <p className="text-sm text-muted-foreground">{t(dict, 'home.unanswered.body')}</p>
        </div>
        <ul className="divide-y rounded-lg border">
          {summary.unansweredQuestions.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{item.question}</p>
                <p className="text-xs text-muted-foreground">
                  {item.timesAsked === 1
                    ? t(dict, 'home.unanswered.once')
                    : t(dict, 'home.unanswered.times', { count: item.timesAsked })}
                </p>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href="/company/business-data?tab=knowledge">
                  {t(dict, 'home.unanswered.cta')}
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export default async function CompanyOverview() {
  const [summary, setup, dict] = await Promise.all([
    getCompanyDashboardSummary(),
    getCompanySetupProgress(),
    getRequestDictionary(),
  ]);

  const purposeStep = setup.steps.find((step) => step.key === 'purpose');
  const hasAssistant = purposeStep?.complete ?? false;
  const isLive = setup.steps.find((step) => step.key === 'install')?.complete ?? false;
  const nextStep = setup.nextStep;
  const stepNumber = nextStep ? setup.steps.findIndex((step) => step.key === nextStep.key) + 1 : 0;
  const isBusy = isLive && summary.conversations7d.current > 0;
  const [firstQueue, ...otherQueues] = summary.attention;
  const setupIncomplete = setup.complete < setup.total;
  /**
   * The website is the first step of setup, so whenever it is outstanding it is
   * also `nextStep` — and then the generic "here is your next step" cards would
   * be describing the very thing the prompt below is already asking, with a link
   * to a page instead of a box to type in. One ask, not two: where the next step
   * IS the website, the prompt replaces those cards rather than joining them.
   */
  const nextStepIsWebsite = nextStep?.key === 'website';
  const showFinishSetup = setupIncomplete && !nextStepIsWebsite;
  /**
   * Rendered in every state, and rendered unconditionally, which looks wasteful
   * until you follow what happens after somebody uses it: the action calls
   * `revalidatePath('/company')`, this page rebuilds, and every server-side
   * reason to show the card is gone. If the mount depended on any of those
   * reasons the card would vanish mid-import and the owner would never learn
   * whether it worked. So the card decides for itself — it renders nothing once
   * the step is done, EXCEPT on the render right after its own submission,
   * where it reports what it read. See the note in `website-prompt.tsx`.
   */
  const websitePrompt = (
    <WebsitePrompt
      companyId={setup.companyId}
      done={setup.steps.find((step) => step.key === 'website')?.complete ?? true}
      defaultUrl={setup.websiteAddress}
      // Formatted here rather than in the card: the card is a client component
      // and `formatDate` is locale-sensitive, so doing it on the server keeps
      // the markup identical on both sides of the hydration boundary.
      lastReadAt={setup.websiteImport ? formatDate(setup.websiteImport.importedAt) : null}
      // The one place it carries the page's solid button is state B, where
      // finishing setup is the only thing on the screen. Anywhere a customer is
      // waiting, or there is no assistant yet, that outranks a missing website.
      solid={hasAssistant && !isLive}
      labels={websitePromptLabels(dict)}
    />
  );
  /**
   * The board also runs for a live tenant with no chats *this week* but
   * something still queued — an enquiry from three weeks ago that nobody rang
   * back is exactly the case the quiet "nobody has chatted yet" card used to
   * bury. Traffic decides whether the 7-day numbers are worth showing, not
   * whether there is work to do.
   */
  const showBoard = isLive && (isBusy || summary.attention.length > 0);

  return (
    // The board earns the width — it is queues, numbers and lists, all of which
    // read better across than down. States A, B and C1 are a paragraph and a
    // button, so they stay at a readable measure instead.
    <div className={`mx-auto space-y-6 ${showBoard ? 'max-w-6xl' : 'max-w-4xl'}`}>
      <RefreshOnFocus />

      {/* The one line of orientation on the landing page. Everything below is a
          single state, so the header says what this screen is FOR rather than
          restating whichever state happens to be showing. */}
      <PageHeader
        title={summary.company.name}
        description={tOr(dict, 'home.description', 'Your assistant, and whatever needs you today.')}
      />

      {/* In the quiet states the website question comes first: there is nothing
          more useful this screen can do than turn one address into the answers
          the rest of setup would otherwise ask them to type. On the board it is
          the other way round and it goes at the bottom — see below. */}
      {!showBoard ? websitePrompt : null}

      {/* ------------------------------------------------------------------ */}
      {/* State A — no assistant yet. No stats: zeroes are demoralising.      */}
      {/* ------------------------------------------------------------------ */}
      {!hasAssistant ? (
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-4 p-6">
              <h2 className="text-lg font-semibold">{t(dict, 'home.setup.title')}</h2>
              <p className="max-w-xl text-sm text-muted-foreground">{t(dict, 'home.setup.body')}</p>
              <div className="flex flex-wrap items-center gap-4">
                {/* The assistant step, not `nextStep`. This used to follow the
                    checklist's first unfinished row, which was the assistant
                    until the website was put in front of it — and a button
                    labelled "Set up my assistant" that opens the website
                    importer is a button that lies. The website ask is the card
                    above; this one is still about making the thing. */}
                <Button asChild size="lg">
                  <Link href={purposeStep?.href ?? '/company/bots/new'}>
                    {t(dict, 'home.setup.cta')}
                  </Link>
                </Button>
                <Link href="/company/setup" className="text-sm underline underline-offset-4">
                  {tOr(dict, 'home.setup.see_list', 'See what is involved')}
                </Link>
              </div>
            </CardContent>
          </Card>
          <div className="grid gap-3 sm:grid-cols-3">
            <FeatureTile
              title={t(dict, 'home.feature.answers.title')}
              body={t(dict, 'home.feature.answers.body')}
            />
            <FeatureTile
              title={t(dict, 'home.feature.details.title')}
              body={t(dict, 'home.feature.details.body')}
            />
            <FeatureTile
              title={t(dict, 'home.feature.handover.title')}
              body={t(dict, 'home.feature.handover.body')}
            />
          </div>
        </div>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* State B — setup in progress. The next step is the whole page.       */}
      {/* ------------------------------------------------------------------ */}
      {hasAssistant && !isLive && nextStep ? (
        <div className="space-y-4">
          {/* Suppressed while the website is the outstanding step: the prompt
              above is that step, asked properly, with somewhere to answer. */}
          {nextStepIsWebsite ? null : (
            <Card>
              <CardContent className="space-y-4 p-6">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  {t(dict, 'home.step.progress', { current: stepNumber, total: setup.total })}
                </p>
                <h2 className="text-lg font-semibold">{nextStep.title}</h2>
                <p className="max-w-xl text-sm text-muted-foreground">{nextStep.description}</p>
                <div className="flex flex-wrap items-center gap-4">
                  <Button asChild size="lg">
                    <Link href={nextStep.href}>{stepCta(dict, nextStep.key)}</Link>
                  </Button>
                  {/* The rail below shows the shape of the list but nothing in
                      it is clickable; this is how you reach the list itself. */}
                  <Link href="/company/setup" className="text-sm underline underline-offset-4">
                    {tOr(dict, 'home.step.see_list', 'See the whole checklist')}
                  </Link>
                </div>
              </CardContent>
            </Card>
          )}
          <StepRail setup={setup} />
        </div>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* State C1 — live, but nobody has chatted this week.                  */}
      {/* ------------------------------------------------------------------ */}
      {isLive && !showBoard ? (
        <Card>
          <CardContent className="space-y-4 p-6">
            <h2 className="text-lg font-semibold">{t(dict, 'home.live.title')}</h2>
            <p className="max-w-xl text-sm text-muted-foreground">{t(dict, 'home.live.body')}</p>
            <div className="flex flex-wrap items-center gap-4">
              <Button asChild size="lg">
                <Link href="/company/widget#test-assistant">{t(dict, 'home.live.ask')}</Link>
              </Button>
              <Link href="/company/widget" className="text-sm underline underline-offset-4">
                {t(dict, 'home.live.check')}
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* State C2 — the board. Needs me → how it's going → what's left.      */}
      {/* ------------------------------------------------------------------ */}
      {showBoard ? (
        <div className="space-y-6">
          {/* 1 — WHAT NEEDS ME RIGHT NOW */}
          {firstQueue ? (
            <section className="space-y-3">
              <h2 className="text-base font-semibold">{t(dict, 'home.attention.heading')}</h2>
              <LeadAttention item={firstQueue} dict={dict} />
              {otherQueues.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
                  {otherQueues.map((item) => (
                    <AttentionTile key={item.key} item={item} dict={dict} />
                  ))}
                </div>
              ) : null}
            </section>
          ) : (
            /* Every queue empty. One sentence, no button — there is nothing to
               push, so the inbox is a link and the page stops talking. */
            <Card>
              <CardContent className="space-y-2 p-6">
                <h2 className="text-lg font-semibold">{t(dict, 'home.clear.title')}</h2>
                <p className="text-sm text-muted-foreground">
                  {t(dict, 'home.clear.body')}{' '}
                  <Link href="/company/inbox" className="underline underline-offset-4">
                    {t(dict, 'home.clear.link')}
                  </Link>
                  .
                </p>
              </CardContent>
            </Card>
          )}

          {/* 2 and 3 — side by side once there is room for both. `min-w-0` on
              the children because a grid child defaults to `min-width:auto`,
              and one long unanswered question would otherwise stretch its
              column and push the whole page past the viewport. */}
          <div className={`grid gap-6 [&>*]:min-w-0 ${showFinishSetup ? 'lg:grid-cols-3' : ''}`}>
            <div className={`space-y-6 ${showFinishSetup ? 'lg:col-span-2' : ''}`}>
              {/* Only worth showing once there is a week to describe. A live
                  tenant reading this because of an old uncontacted enquiry
                  would otherwise get four honest zeroes. */}
              {isBusy ? <WeekSignals summary={summary} dict={dict} /> : null}
              {summary.unansweredQuestions.length > 0 ? (
                <UnansweredQuestions summary={summary} dict={dict} />
              ) : null}
            </div>
            {showFinishSetup ? (
              <div className="lg:sticky lg:top-6 lg:self-start">
                <FinishSetup setup={setup} dict={dict} />
              </div>
            ) : null}
          </div>

          {/* Last on the board, and deliberately so. Everything above it is
              either a customer waiting or a number about this week; a missing
              website import is neither, and putting it over the queue would be
              the product interrupting the owner's morning to ask for a favour. */}
          {websitePrompt}
        </div>
      ) : null}
    </div>
  );
}
