import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { env } from '@/lib/env';
import { formatDate } from '@/lib/format';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CopyButton } from '@/components/copy-button';
import { listBots } from '@/modules/company/data';
import { getCompanySetupProgress, type SetupStep } from '@/modules/company/setup-data';
import { TestAssistant } from '@/modules/company/components/test-assistant';
import { WebsiteOnboardingForm } from '@/modules/company/components/website-onboarding-form';
import {
  GUIDE_COPY,
  GUIDE_DONE,
  guideHref,
  isGuideScreen,
  type GuideScreen,
} from '@/modules/onboarding/guide-content';
import { GuideFooter, GuideShell } from '@/modules/onboarding/components/guide-shell';
import { SkipStepLink } from '@/modules/onboarding/components/guide-skip';
import type { SetupStepKey } from '@/lib/constants';

/**
 * Guided setup — the checklist, one screen at a time.
 *
 * WHAT THIS IS, AND WHAT IT LEAVES ALONE
 * --------------------------------------
 * `/company/setup` is the checklist: every row at once, which is the right
 * shape for "what have I still got left?" and the wrong shape for the first ten
 * minutes of a trial. This is the same steps, in the same order, from the same
 * `getCompanySetupProgress()` — one decision per screen, with the position
 * visible, a way back, and a way past.
 *
 * Nothing here computes whether a step is finished; it is told. There is no new
 * table, no cursor and no second definition of "done" that could drift from the
 * checklist's.
 *
 * WHERE THE WORK ACTUALLY HAPPENS
 * -------------------------------
 * Two steps have to be done somewhere else — creating an assistant and choosing
 * its jobs both live on the assistant form, which this page does not own and
 * does not duplicate. Those screens explain the decision and hand over.
 *
 * The rest do their real work here, inline, because a component for each already
 * exists and sending somebody to a different page to paste one line of code is
 * how a trial goes cold:
 *   - step 1 imports a website (`WebsiteOnboardingForm`),
 *   - the test step asks the assistant a live question (`TestAssistant`),
 *   - the install step shows the actual `<script>` tag with a copy button.
 *
 * The finish screen ends on both of the two things that are worth ending on:
 * the install snippet, and a box the customer can type a question into and get
 * a real answer from. It does not end on a dashboard.
 */

export const metadata = { title: 'Set up your assistant' };

/**
 * What one screen changes about the shared frame.
 *
 * `primary` is the single solid button, and it means one thing everywhere: the
 * next thing to do. On the two steps whose work lives on another page it opens
 * that page; on the three that do their work inline it moves to the next step,
 * because the work is already on the screen and a second button pointing back
 * at a page that does the same job is a decision nobody should have to make.
 */
interface ScreenPlan {
  /** The footer's primary control. */
  primary: React.ReactNode;
  /**
   * Whether "Skip for now" appears. It does not on the screens where moving on
   * *is* the skip — offering both would be two controls, differently worded,
   * going to the same place.
   */
  skippable: boolean;
  /**
   * Overrides "Skip for now" where the honest wording is a statement about the
   * business rather than a deferral — see the website screen.
   */
  skipLabel?: string;
  /** Screen-specific body. */
  body: React.ReactNode;
}

function StepIntro({ step, screenKey }: { step: SetupStep; screenKey: SetupStepKey }) {
  const copy = GUIDE_COPY[screenKey];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{copy.question}</h1>
        {step.complete ? <Badge variant="success">Done</Badge> : null}
      </div>
      <p className="text-sm text-muted-foreground">{copy.why}</p>
    </div>
  );
}

export default async function SetupGuidePage({
  searchParams,
}: {
  searchParams: { step?: string };
}) {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const [setup, bots] = await Promise.all([getCompanySetupProgress(), listBots()]);

  const keys = setup.steps.map((step) => step.key);
  const requested = searchParams.step;

  // No screen asked for, or one that does not exist: land on the first thing
  // still to do. This is what makes the flow resumable across a closed tab —
  // the answer is recomputed from the company's real data every time, so it is
  // right a week later without anything having been stored.
  if (!isGuideScreen(requested) || !(requested === GUIDE_DONE || keys.includes(requested))) {
    redirect(guideHref((setup.nextStep?.key as GuideScreen) ?? GUIDE_DONE));
  }

  const screen = requested as GuideScreen;
  const index = keys.indexOf(screen);
  const step = index >= 0 ? setup.steps[index]! : null;
  const previousHref = index > 0 ? guideHref(keys[index - 1] as GuideScreen) : '/company/setup';
  const nextScreen: GuideScreen =
    screen === GUIDE_DONE
      ? GUIDE_DONE
      : index === keys.length - 1
        ? GUIDE_DONE
        : (keys[index + 1] as GuideScreen);
  const nextTitle = index >= 0 && index < keys.length - 1 ? setup.steps[index + 1]!.title : null;

  // The assistant a website visitor would actually talk to. Falls back to any
  // assistant so the install screen is never blank for a company that has only
  // made an internal one — it says so instead.
  const customerBot = bots.find((bot) => bot.assistantAudience === 'customer') ?? null;
  const snippetBot = customerBot ?? bots[0] ?? null;
  const embed = snippetBot
    ? `<script src="${env.NEXT_PUBLIC_WIDGET_URL}" data-bot-id="${snippetBot.publicBotId}"></script>`
    : null;

  /* ------------------------------------------------------------------ */
  /* The finish screen.                                                  */
  if (screen === GUIDE_DONE) {
    return (
      <GuideShell steps={setup.steps} current={GUIDE_DONE} complete={setup.complete}>
        <div className="space-y-5">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {setup.complete === setup.total
                ? `${setup.companyName} is live.`
                : 'That is the guided part done.'}
            </h1>
            <p className="text-sm text-muted-foreground">
              {setup.complete === setup.total
                ? 'Your assistant is on your website and answering. Here is the code again, and a box to ask it something yourself.'
                : `You have finished ${setup.complete} of the ${setup.total} steps. The rest are waiting on the checklist whenever you want them — here is where you are up to.`}
            </p>
          </div>

          {embed ? (
            <InstallCard embed={embed} bot={snippetBot} isCustomerBot={Boolean(customerBot)} />
          ) : (
            <Alert tone="warning" title="There is no assistant to install yet">
              &ldquo;Choose what it does&rdquo; makes one. It takes about two minutes, and everything
              else follows from it.
            </Alert>
          )}

          {/* Ending on a live answer rather than on a dashboard: the last thing
              a new customer sees is their own question, answered. */}
          <TestAssistant />

          <GuideFooter
            back={
              <Button asChild variant="outline" size="lg">
                <Link href={guideHref(keys[keys.length - 1] as GuideScreen)}>Back</Link>
              </Button>
            }
            primary={
              <Button asChild size="lg">
                <Link href="/company">Go to my dashboard</Link>
              </Button>
            }
            skip={
              <Button asChild variant="ghost" size="lg">
                <Link href="/company/setup">See the whole checklist</Link>
              </Button>
            }
          />
        </div>
      </GuideShell>
    );
  }

  /* ------------------------------------------------------------------ */
  /* One of the steps.                                                   */
  const screenKey = screen as SetupStepKey;
  const copy = GUIDE_COPY[screenKey];
  const current = step!;

  const nextButton = (
    <Button asChild size="lg">
      <Link href={guideHref(nextScreen)}>
        {nextTitle ? `Next: ${nextTitle}` : 'Finish setup'}
      </Link>
    </Button>
  );
  const openFullPage = (
    <Button asChild size="lg">
      <Link href={current.href}>{copy.cta}</Link>
    </Button>
  );

  const plan: ScreenPlan = {
    primary: current.complete ? nextButton : openFullPage,
    skippable: !current.complete,
    body: null,
  };

  if (screenKey === 'website') {
    // The import happens here, on this screen, so "next" is the only forward
    // control — the same rule the test and install screens follow. The default
    // `openFullPage` would have pointed this step's own href back at itself.
    plan.primary = nextButton;
    // The skip survives anyway, unlike on those two screens, because it says
    // something different from "next". Moving on means "not yet"; this says
    // "there is nothing of mine to read", which is a fact about the business
    // rather than a failure to finish a step — and it is the one thing the
    // guide cannot work out for itself.
    plan.skippable = !current.complete;
    plan.skipLabel = 'I do not have a website';
    plan.body = (
      <div className="space-y-4">
        {/* Once it has happened this stops being an instruction and becomes a
            record of it. Asking again under a green "Done" badge reads as a job
            still outstanding, which is the one thing this flow must not do. */}
        {setup.websiteImport ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Your website has been read</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                We saved what we found as knowledge your assistant can use. Import it again whenever
                the site changes — it updates what is there rather than adding a second copy.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/40 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{setup.websiteImport.title}</p>
                  <p className="text-xs text-muted-foreground">
                    Read {formatDate(setup.websiteImport.importedAt)}
                  </p>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link href="/company/business-data?tab=knowledge">See what it found</Link>
                </Button>
              </div>
              <WebsiteOnboardingForm defaultUrl={setup.websiteAddress} />
            </CardContent>
          </Card>
        ) : (
          <WebsiteOnboardingForm defaultUrl={setup.websiteAddress} />
        )}

        <div className="grid gap-3 lg:grid-cols-3">
          <FactCard
            title="It saves you the typing"
            body="Services, opening hours, policies and contact details come across on their own, so the steps after this are mostly checking."
          />
          <FactCard
            title="Prices and stock need a link"
            body="For anything that changes daily, connect Shopify, WooCommerce or a spreadsheet, so it stays right by itself."
          />
          <FactCard
            title="No website is fine"
            body="Say so and we move on. You add the same facts by hand later, and nothing else in setup depends on this."
          />
        </div>
      </div>
    );
  }

  if (screenKey === 'purpose') {
    plan.body = (
      <div className="space-y-4">
        {/* The decision itself, as two things to choose between rather than a
            sentence describing that a choice exists. Both go to the same form —
            the form is where the choice is recorded — but the reader makes the
            decision here, which is the whole point of one screen per step. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <ChoiceCard
            href="/company/bots/new"
            title="My customers, on my website"
            body="Answers the questions visitors ask: what you sell, what it costs, when you are open, where their order is."
            note="This is what almost everybody starts with."
          />
          <ChoiceCard
            href="/company/bots/new"
            title="My own staff"
            body="A help desk for your team: internal policies, how-to answers, and the things new starters always ask."
            note="You can add one of these later as well."
          />
        </div>
        {bots.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">What you have already</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {bots.map((bot) => (
                <div
                  key={bot.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{bot.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {bot.assistantAudience === 'internal'
                        ? 'Answers your own staff'
                        : 'Answers customers on your website'}
                    </p>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/company/bots/${bot.id}/settings`}>Change this</Link>
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}
      </div>
    );
  }

  if (screenKey === 'capabilities') {
    const capabilities = setup.customerReadiness.capabilities;
    plan.body = bots.length === 0 ? (
      <Alert tone="info" title="Make the assistant first">
        There is nothing to give jobs to yet. &ldquo;Choose what it does&rdquo; takes about two
        minutes, and this screen will be waiting.
      </Alert>
    ) : (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {setup.customerReadiness.enabledCount > 0
            ? `${setup.customerReadiness.enabledCount} turned on so far. Anything switched off is not lost — you can turn it on any time.`
            : 'Nothing is turned on yet. Pick the jobs you want it doing today.'}
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {capabilities.map((capability) => (
            <li
              key={capability.key}
              className="flex items-start justify-between gap-3 rounded-md border p-3"
            >
              <span className="min-w-0 text-sm">{capability.label}</span>
              <Badge variant={capability.enabled ? 'success' : 'secondary'} className="shrink-0">
                {capability.enabled ? 'On' : 'Off'}
              </Badge>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (screenKey === 'required-data') {
    plan.primary = current.complete ? nextButton : openFullPage;
    plan.body = (
      <div className="space-y-4">
        {/* This screen used to carry the import form itself, back when the
            website was not a step and this was the only place it was offered.
            It is step 1 now, so a second copy of the same form here would be
            asking a question that has already been asked and, for a business
            with no website, one it has already answered. What is left is the
            two things this screen can honestly say about it. */}
        {setup.websiteImport ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Your website is already in here</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                We read your pages on {formatDate(setup.websiteImport.importedAt)}. This step is for
                what a website cannot tell us — prices you never published, the answers you give on
                the phone, the rules only your staff know.
              </p>
            </CardHeader>
            <CardContent>
              <Button asChild size="sm" variant="outline">
                <Link href="/company/business-data?tab=knowledge">See what it found</Link>
              </Button>
            </CardContent>
          </Card>
        ) : setup.websiteAddress ? (
          // Only for a company whose address is on file and unread. A business
          // that told us it has no website is not sent back to be asked again.
          <Alert tone="info" title="There is a shortcut you have not used">
            We have {setup.websiteAddress} on file but have not read it yet. Step 1 fetches those
            pages and fills in most of this for you.{' '}
            <Link href={guideHref('website')} className="underline underline-offset-4">
              Go back and import it
            </Link>
            .
          </Alert>
        ) : null}

        <div className="grid gap-3 lg:grid-cols-3">
          <FactCard
            title="Start with the repeats"
            body="The questions you answer every week — opening hours, delivery, refunds — are worth more here than anything else."
          />
          <FactCard
            title="Prices and stock need a link"
            body="For anything that changes daily, connect Shopify, WooCommerce or a spreadsheet, so it stays right by itself."
          />
          <FactCard
            title="It will never guess"
            body="Until your product list is connected it tells customers to check with you rather than making a number up."
          />
        </div>
      </div>
    );
  }

  if (screenKey === 'test') {
    // The tester is on this screen, so "next" is the only forward control and
    // moving on without asking anything is itself the skip.
    plan.primary = nextButton;
    plan.skippable = false;
    plan.body = (
      <div className="space-y-4">
        {setup.customerReadiness.missingCritical.length ? (
          <Alert tone="warning" title="Some answers will be thin until these are filled in">
            <ul className="list-inside list-disc space-y-1">
              {setup.customerReadiness.missingCritical.slice(0, 4).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Alert>
        ) : null}

        {/* The real thing, on the screen. Somebody finishing this step has
            watched their own assistant answer their own question, which is the
            only version of "it works" worth anything. */}
        <TestAssistant />

        {setup.customerReadiness.testScenarios.length ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Worth asking it</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                One of these per job you turned on, plus one it cannot possibly know.
              </p>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {setup.customerReadiness.testScenarios.map((scenario) => (
                  <li key={scenario} className="rounded-md border p-3 text-sm">
                    {scenario}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
      </div>
    );
  }

  if (screenKey === 'install') {
    // Same again: the code is on this screen, with a copy button on it.
    plan.primary = nextButton;
    plan.skippable = false;
    plan.body = embed ? (
      <InstallCard embed={embed} bot={snippetBot} isCustomerBot={Boolean(customerBot)} />
    ) : (
      <Alert tone="info" title="There is no assistant to install yet">
        Go back to &ldquo;Choose what it does&rdquo; and make one — the code on this screen is
        generated from it.
      </Alert>
    );
  }

  return (
    <GuideShell
      steps={setup.steps}
      current={screen}
      complete={setup.complete}
      meta={current.complete ? 'already done' : copy.minutes}
    >
      <div className="space-y-5">
        <StepIntro step={current} screenKey={screenKey} />
        {plan.body}

        {/* Skipping is offered out loud, with the cost of skipping written next
            to it. A step nobody may skip is a step people abandon the product
            at; a skip with no stated consequence is a trap. */}
        {plan.skippable ? (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">If you skip this:</span> {copy.skipCost}
          </p>
        ) : null}

        <GuideFooter
          back={
            <Button asChild variant="outline" size="lg">
              <Link href={previousHref}>{index === 0 ? 'Back to the checklist' : 'Back'}</Link>
            </Button>
          }
          skip={
            plan.skippable ? (
              <SkipStepLink
                companyId={setup.companyId}
                stepKey={screenKey}
                href={guideHref(nextScreen)}
              >
                {plan.skipLabel ?? 'Skip for now'}
              </SkipStepLink>
            ) : null
          }
          primary={plan.primary}
        />
      </div>
    </GuideShell>
  );
}

/**
 * One of the two answers to "who is this for?".
 *
 * A whole card is the target, not a link buried in it — at 375px a text link
 * inside a bordered box is a 20px-tall tap area inside a 120px-tall thing that
 * looks tappable.
 */
function ChoiceCard({
  href,
  title,
  body,
  note,
}: {
  href: string;
  title: string;
  body: string;
  note: string;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col rounded-lg border bg-card p-4 transition-colors hover:border-primary hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <span className="font-medium">{title}</span>
      <span className="mt-1.5 text-sm text-muted-foreground">{body}</span>
      <span className="mt-3 text-xs text-muted-foreground">{note}</span>
    </Link>
  );
}

function FactCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{body}</p>
    </div>
  );
}

/**
 * The install snippet, with somewhere to paste it.
 *
 * `overflow-x-auto` on the `<pre>` and nowhere else: the snippet is a single
 * long line that must never be what makes the page scroll sideways on a phone.
 */
function InstallCard({
  embed,
  bot,
  isCustomerBot,
}: {
  embed: string;
  bot: { name: string; domainAllowlist: string[] } | null;
  isCustomerBot: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Your website code</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          Paste this once, just before the closing <code className="font-mono">&lt;/body&gt;</code>{' '}
          tag of your site. Whoever built your website will know where that is.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{embed}</pre>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <CopyButton value={embed} label="Copy the code" />
            {bot ? (
              <span className="text-xs text-muted-foreground">
                For {bot.name}
                {isCustomerBot ? '' : ' — the only assistant you have is an internal one'}
              </span>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <FactCard
            title="WordPress"
            body="Add it with a header/footer scripts plugin, or paste it in the theme footer. Clear the cache afterwards."
          />
          <FactCard
            title="Shopify"
            body="Online Store → Themes → Edit code → theme.liquid, then paste it before </body>."
          />
          <FactCard
            title="Wix, Squarespace and similar"
            body="Look for custom code or embeds in the site settings, and add it to every page."
          />
          <FactCard
            title="A site your developer built"
            body="Put it in the shared layout or footer so it loads on every customer-facing page."
          />
        </div>

        {bot && bot.domainAllowlist.length === 0 ? (
          <Alert tone="warning" title="Add your web address before you go live">
            Without it, anyone who finds this code could put your assistant on their own site. Add
            the domain on the website chat page — it takes a moment.
          </Alert>
        ) : null}

        <Button asChild variant="outline">
          <Link href="/company/widget">Open the website chat settings</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
