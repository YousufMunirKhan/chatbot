import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { SETUP_STEPS } from '@/lib/constants';
import {
  HOSTING_STATEMENT,
  VAT_SHORT,
  VAT_STATEMENT,
  count,
  gbp,
  getPublicPricing,
} from '../pricing/plan-catalogue';

/**
 * "How setup works" — one of the two pages a stranger ever sees.
 *
 * WHY IT MOVED INTO `(marketing)`
 * -------------------------------
 * It used to live at `src/app/customer-onboarding/page.tsx`, outside the route
 * group, which meant it was the only public page in the product with no header,
 * no nav, no sign-in link and no footer — no Privacy, no Terms, no AI
 * disclosure. It rendered its own `<main>`, its own logo plate and its own
 * container width (`max-w-7xl` against the header's `max-w-6xl`, so even the
 * logo did not line up with the one on `/pricing`). A route group does not
 * appear in the URL, so `/customer-onboarding` is unchanged and every existing
 * link still lands here; it just arrives inside the same chrome as the rest of
 * the public site.
 *
 * WHAT ELSE WAS WRONG
 * -------------------
 *  - `bg-[#f4f7fb] text-slate-950` with `bg-white` cards and `text-slate-600`
 *    body copy: the page was hardcoded light. In dark mode the header and
 *    footer around it flipped and the page did not.
 *  - The hero was `min-h-[92vh]`, which on a phone reserved almost a full
 *    screen for a heading and pushed everything else below the fold.
 *  - The screenshot mock nested `lg:grid-cols-[0.7fr_1fr]` inside a column that
 *    is itself `1.1fr` of a 1280px grid. `lg:` measures the viewport, so at
 *    1024px each half of that inner grid was about 200px and 290px wide — with
 *    a `sm:grid-cols-2` inside the narrower half, giving 120px boxes. It is one
 *    column now, sized for the box it is in rather than for the screen.
 *
 * Every number on the page is still read from the billing catalogue, never
 * typed, and the five steps are still `SETUP_STEPS` — the same list the product
 * runs and the setup page renders.
 */

export const metadata: Metadata = {
  title: 'How setup works — Switch & Save AI Assistant',
  description:
    'The five steps from signing up to a working assistant on your website: choose what it does, pick its jobs, add your business details, test it, and paste one line of code.',
};

export const runtime = 'nodejs';
// This page quotes a real price, and a price is only worth quoting if it is the
// live one. Caching it would let the brochure advertise a figure the checkout
// no longer honours.
export const dynamic = 'force-dynamic';

// The journey shown here is the journey the product actually runs. It used to
// be a retyped copy that had already drifted — four steps against the product's
// five, with "try it" and "install" merged — so a visitor was promised one
// thing and given another.
const journey = SETUP_STEPS.map((step) => [step.title, step.description] as const);

const integrations: Array<[string, string]> = [
  ['Your website', 'Paste one line into any site builder, or into a site somebody built for you.'],
  [
    'Your own systems',
    'Connect .NET, Node, PHP, JavaScript, mobile or ERP apps through the REST API and webhooks.',
  ],
  [
    'No developer? No problem',
    'Upload a CSV of products, stock, orders, customers or menu items instead.',
  ],
];

const SNIPPET = `<script
  src="https://switchandsave.ai/widget.js"
  data-bot="your-public-bot-id">
</script>`;

export default async function CustomerOnboardingPage() {
  // This page used to describe the whole journey without ever saying what it
  // cost, so a reader got all the way to the signup form still guessing. The
  // number is read, never typed — same source as /pricing and the billing page.
  const { plans, trialDays } = await getPublicPricing();
  const entry = plans
    .filter((plan) => plan.priceMonthlyGbp > 0)
    .reduce<(typeof plans)[number] | null>(
      (cheapest, plan) =>
        !cheapest || plan.priceMonthlyGbp < cheapest.priceMonthlyGbp ? plan : cheapest,
      null,
    );

  return (
    <div className="bg-background">
      {/* ------------------------------------------------------------------ */}
      {/* Hero. `bg-brand-sidebar` is the product's one dark decorative
          surface and it is a fixed ramp in both themes, so its text uses the
          sidebar foreground tokens rather than a raw white that only works
          against one of them. */}
      <section className="bg-brand-sidebar text-sidebar-fg">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-2 lg:items-center lg:py-20">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sidebar-fg-subtle">
              How setup works
            </p>
            <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
              A working assistant, without a technical conversation.
            </h1>
            <p className="mt-5 max-w-xl text-base text-sidebar-fg-muted sm:text-lg">
              Setup asks what you want the assistant to do, collects only the business facts that
              answer needs, and finishes by giving you one line of code for your website.
            </p>

            {/* The price belongs above the fold, not behind the signup form. A
                reader who has to create an account to find out what it costs
                usually just leaves. */}
            <p className="mt-5 text-sm font-medium sm:text-base">
              {entry
                ? `From ${gbp(entry.priceMonthlyGbp)} a month ${VAT_SHORT}, hosted in London.`
                : 'Priced in pounds, hosted in London.'}{' '}
              <Link
                href="/pricing"
                className="rounded-sm underline underline-offset-4 hover:text-sidebar-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-fg"
              >
                See all packages
              </Link>
            </p>

            {/* Three buttons that wrap rather than shrink: at 375px they stack
                to full width instead of squeezing a label onto two lines. */}
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Button asChild size="lg" className="bg-brand-plate text-brand-sidebar hover:opacity-90">
                <Link href="/signup">
                  {trialDays ? `Start free for ${trialDays} days` : 'Start free'}
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-white/30 bg-transparent text-sidebar-fg hover:bg-sidebar-hover hover:text-sidebar-fg"
              >
                <Link href="/pricing">See pricing</Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="ghost"
                className="text-sidebar-fg hover:bg-sidebar-hover hover:text-sidebar-fg"
              >
                <Link href="/login">I already have an account</Link>
              </Button>
            </div>

            {/* These used to all say "Built into onboarding", which told a
                reader nothing. Each one now carries the fact behind it. */}
            <dl className="mt-10 grid gap-3 sm:grid-cols-3">
              {[
                ['No-code launch', 'One line of code on your site'],
                ['Human handoff', 'Your team takes over mid-chat'],
                ['Priced in pounds', `${VAT_SHORT}, and no charge per conversation`],
              ].map(([label, detail]) => (
                <div key={label} className="rounded-lg border border-white/15 bg-white/10 p-4">
                  <dt className="text-sm font-semibold">{label}</dt>
                  <dd className="mt-1 text-xs text-sidebar-fg-muted">{detail}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* --------------------------------------------------------------- */}
          {/* What the setup screen looks like. One column inside the card, so
              it is sized by the card and not by the viewport — the old version
              split itself in two at `lg`, which is when the card is at its
              narrowest relative to the screen. */}
          <div className="min-w-0">
            <div className="overflow-hidden rounded-lg border bg-card text-card-foreground shadow-lg">
              <div className="flex items-center gap-2 border-b bg-muted px-4 py-3">
                <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-danger" />
                <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-warning" />
                <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-success" />
                <span className="ms-2 truncate text-xs text-muted-foreground">
                  switchandsave.ai/company/setup
                </span>
              </div>

              <div className="space-y-4 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="rounded-full border border-info-border bg-info-bg px-2.5 py-0.5 text-xs font-medium text-info-fg">
                    3 of 5 done
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Picks up where you left off
                  </span>
                </div>

                <ol className="space-y-1.5">
                  {journey.map(([title], index) => (
                    <li
                      key={title}
                      className="flex items-center gap-3 rounded-md border p-2.5 text-sm"
                    >
                      <span
                        aria-hidden="true"
                        className={
                          index < 3
                            ? 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-success-border bg-success-bg text-xs font-semibold text-success-fg'
                            : 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold text-muted-foreground'
                        }
                      >
                        {index < 3 ? '✓' : index + 1}
                      </span>
                      <span className="min-w-0">{title}</span>
                    </li>
                  ))}
                </ol>

                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Step 5 hands you this
                  </p>
                  {/* The one genuinely wide thing on the page. It scrolls
                      inside its own box; the page body never does. */}
                  <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-xs">
                    {SNIPPET}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      <section className="mx-auto max-w-6xl px-5 py-14 sm:px-8" aria-labelledby="the-five-steps">
        <div className="max-w-2xl">
          <h2 id="the-five-steps" className="text-2xl font-bold tracking-tight sm:text-3xl">
            Five steps, in this order
          </h2>
          <p className="mt-3 text-muted-foreground">
            You never have to understand prompts, retrieval or integrations. You say what you want
            the assistant to do, and it asks you for the facts that answer needs. Each step saves as
            you finish it, so you can stop and come back.
          </p>
        </div>

        <ol className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {journey.map(([title, text], index) => (
            <li key={title} className="flex flex-col rounded-lg border bg-card p-5">
              <span
                aria-hidden="true"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
              >
                {index + 1}
              </span>
              <p className="mt-3 font-semibold">{title}</p>
              <p className="mt-2 text-sm text-muted-foreground">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ------------------------------------------------------------------ */}
      <section className="border-y bg-muted/30" aria-labelledby="integration">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
          <h2 id="integration" className="text-2xl font-bold tracking-tight sm:text-3xl">
            Simple to connect, without being shallow
          </h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {integrations.map(([title, text]) => (
              <div key={title} className="rounded-lg border bg-card p-5">
                <p className="font-semibold">{title}</p>
                <p className="mt-2 text-sm text-muted-foreground">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* The end of the brochure is where a reader decides, and until recently
          it ended without ever naming a price or saying where the data sits.
          Both answers are here, both read from the same catalogue the checkout
          charges from rather than written into this file. */}
      <section className="mx-auto max-w-6xl px-5 py-14 sm:px-8" aria-labelledby="what-it-costs">
        <div className="grid gap-8 lg:grid-cols-2">
          <div className="min-w-0">
            <h2 id="what-it-costs" className="text-2xl font-bold tracking-tight sm:text-3xl">
              What it costs, and where it lives
            </h2>
            <p className="mt-3 text-muted-foreground">{VAT_STATEMENT}</p>
            <p className="mt-3 text-muted-foreground">{HOSTING_STATEMENT}</p>
            <div className="mt-6">
              <Button asChild size="lg">
                <Link href="/pricing">See the full price list</Link>
              </Button>
            </div>
          </div>

          <ul className="grid gap-3 sm:grid-cols-2">
            {plans.slice(0, 4).map((plan) => (
              <li key={plan.key} className="rounded-lg border bg-card p-5">
                <p className="font-semibold">{plan.label}</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight">
                  {plan.priceMonthlyGbp === 0 ? 'Free' : gbp(plan.priceMonthlyGbp)}
                  {plan.priceMonthlyGbp === 0 ? null : (
                    <span className="text-sm font-normal text-muted-foreground">/mo</span>
                  )}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {count(plan.monthlyReplies)} AI replies a month
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      <section className="border-t bg-muted/30">
        <div className="mx-auto max-w-3xl px-5 py-14 text-center sm:px-8">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {trialDays ? `Set it up free for ${trialDays} days.` : 'Set it up free.'}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            No card, no call, no installation appointment. Sign up and the first step is waiting for
            you.
          </p>
          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/signup">Start free</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/pricing">See pricing</Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
