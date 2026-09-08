import { cache } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { CHANNEL_KEYS } from '@/lib/channels/types';
import { SETUP_STEPS } from '@/lib/constants';
import { env } from '@/lib/env';
import { JsonLd } from '@/modules/help-center/help-center-list';
import {
  AI_RESIDENCY_STATEMENT,
  HOSTING_STATEMENT,
  VAT_SHORT,
  VAT_STATEMENT,
  count,
  gbp,
  getPublicPricing,
  type PublicPlan,
} from './pricing/plan-catalogue';

/**
 * The homepage.
 *
 * WHAT WAS HERE BEFORE, AND WHY IT HAD TO GO
 * ------------------------------------------
 * `src/app/page.tsx` was one line: `redirect('/pricing')`. In a browser that is
 * invisible, because React resolves it client-side and the reader lands on the
 * pricing page without noticing. To anything that speaks plain HTTP it was not
 * invisible at all: `https://chatbot.ssepos.co.uk/` answered `307` with **no
 * `Location` header**, a 5,335-byte empty shell, and `s-maxage=31536000` — a
 * crawler was handed a redirect it could not follow and told to cache that
 * answer for a year, on the one URL the business has the most claim to.
 *
 * The second cost was subtler and probably larger. With the root redirecting,
 * the site had no page describing what the product IS. `/pricing` was left
 * carrying both the category query ("ai customer chat uk") and the pricing
 * query ("ai chat pricing"), which are different searches by different people
 * at different stages, and a page that answers two intents answers neither
 * well. This page takes the category; `/pricing` keeps the price.
 *
 * WHY IT LIVES IN `(marketing)` AND NOT AT THE APP ROOT
 * ----------------------------------------------------
 * A route group adds no path segment, so `(marketing)/page.tsx` IS `/`. Putting
 * it here rather than back at `src/app/page.tsx` is what gives the homepage the
 * same header, footer and skip link as `/pricing` and `/customer-onboarding`.
 * The old root file had to be DELETED rather than emptied: two files resolving
 * to `/` is a build error, not a precedence rule.
 *
 * NOTHING HERE IS A NUMBER SOMEBODY TYPED
 * ---------------------------------------
 * Prices, allowances and the trial length come from `getPublicPricing()`, which
 * reads the billing catalogue Stripe actually charges from. The channel count
 * is `CHANNEL_KEYS.length` and the setup steps are `SETUP_STEPS`, the same list
 * the product runs. See the doc comment in `./pricing/plan-catalogue` for why a
 * retyped price on a public page is worse than no price at all.
 *
 * NO SOCIAL PROOF, ON PURPOSE
 * ---------------------------
 * There are no customers yet, so there are no logos, no testimonials, no review
 * scores, no uptime figure and no customer count on this page. The honesty
 * section says so out loud rather than leaving a reader to wonder. Inventing
 * any of it would be a lie in the shop window, and the one thing this product
 * sells harder than price is that it tells you the inconvenient half.
 */

export const runtime = 'nodejs';
/**
 * Live, not cached.
 *
 * Two reasons, and the second is the one that bit. The page quotes real prices,
 * so a cached copy could advertise a figure the checkout no longer honours. And
 * the root URL was being served with `s-maxage=31536000` — a year of a wrong
 * answer at the edge, which is how a five-minute bug survived for months.
 */
export const dynamic = 'force-dynamic';

/**
 * The catalogue read, deduped for the request.
 *
 * `generateMetadata()` and the component below both need the entry price, and
 * Next calls them separately for the same request. Without `cache` that is two
 * round trips to Postgres to render one page. `getPublicPricing` lives in a
 * file this page may not edit, so the memoisation is applied at the call site.
 */
const pricing = cache(getPublicPricing);

/**
 * The `<h1>` and the `<title>`, written once and used in both.
 *
 * It is a category, not a slogan. Nobody searches for a clever line, and this
 * is the only page on the site aimed at somebody who does not yet know the
 * product exists. The brand is deliberately absent: `src/app/layout.tsx` sets
 * `title.template` to `'%s — Switch & Save'`, so writing it here would ship
 * "… — Switch & Save — Switch & Save".
 */
const CATEGORY = 'AI customer chat for UK small businesses';

/** Origin without a trailing slash, matching what `sitemap.ts` and `robots.ts` build. */
const SITE = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');

/** Counted from the channel registry, never claimed. Same source as `/pricing`. */
const CHANNEL_COUNT = CHANNEL_KEYS.length;

/** The cheapest package a stranger can actually buy, found rather than written. */
function cheapestPaid(plans: PublicPlan[]): PublicPlan | null {
  return plans
    .filter((plan) => plan.priceMonthlyGbp > 0)
    .reduce<PublicPlan | null>(
      (cheapest, plan) => (!cheapest || plan.priceMonthlyGbp < cheapest.priceMonthlyGbp ? plan : cheapest),
      null,
    );
}

export async function generateMetadata(): Promise<Metadata> {
  const { plans } = await pricing();
  const entry = cheapestPaid(plans);

  // Under 160 characters, and the price leads because it is the thing a buyer
  // is squinting at the search result for. It is read from the catalogue, so a
  // reprice moves the search snippet with it.
  const description = entry
    ? `From ${gbp(entry.priceMonthlyGbp)} a month ${VAT_SHORT}: AI chat and a shared inbox for UK small businesses, on your website, WhatsApp, SMS and email. Data stored in the UK.`
    : 'AI chat and a shared inbox for UK small businesses, on your website, WhatsApp, SMS and email. Flat pricing in pounds, VAT included. Data stored in the UK.';

  return {
    title: CATEGORY,
    description,
    alternates: { canonical: '/' },
    // `openGraph` is replaced wholesale by a child, not merged, so `siteName`
    // and `locale` are restated here rather than inherited from the root.
    // The title is brand-free for the same reason the page title is.
    openGraph: {
      type: 'website',
      url: '/',
      siteName: 'Switch & Save',
      locale: 'en_GB',
      title: CATEGORY,
      description,
    },
  };
}

/**
 * An illustration of the shared inbox, not a screenshot.
 *
 * Channel names are the product's own words for those channels. The rows are
 * plainly hypothetical questions; nothing here is a metric, a result or a
 * customer.
 */
const INBOX_PREVIEW: Array<[channel: string, message: string, state: string]> = [
  ['Website chat', 'Do you deliver to CF10?', 'Answered'],
  ['WhatsApp', 'Is the blue one back in stock?', 'Answered from your stock'],
  ['Email', 'I need to change my order', 'Passed to a person'],
];

/** What the product does, limited to what it actually does today. */
const CAPABILITIES: Array<[string, string]> = [
  [
    'On your website',
    'One line of code on any site — Wix, Squarespace, WordPress, Shopify or something built by hand. It answers in your colours, from your own business information.',
  ],
  [
    `On WhatsApp, SMS, email and ${CHANNEL_COUNT - 3} more`,
    'WhatsApp, Instagram, Facebook, Telegram, Viber, LINE, TikTok, YouTube, SMS and email, all answered by the same assistant that knows the same things everywhere.',
  ],
  [
    'One shared inbox',
    'Every conversation from every channel in one place. Your team can take over mid-chat, and the customer never sees the join.',
  ],
  [
    'Tickets, when a chat becomes a job',
    'An enquiry that needs following up gets an owner and a due time instead of sinking down a chat thread somebody forgot to scroll back through.',
  ],
  [
    'You find out whether the answer helped',
    'Customers can rate the conversation afterwards, so you can see which answers work and which ones send people away no better off.',
  ],
  [
    'It knows your stock and your orders',
    'Connect Shopify or WooCommerce, upload a spreadsheet, or point it at your own API, and it answers "is this in stock" and "where is my order" from live data.',
  ],
  [
    'Help articles, written once',
    'Your assistant answers from them, and your customers can read the same articles themselves in your own help centre.',
  ],
  [
    'A copilot for whoever is on the inbox',
    'It drafts a reply from your own content and your team edits it before it sends. Nothing goes out that a person has not seen.',
  ],
  [
    'It says it does not know',
    'It answers from your business information and your help articles rather than guessing. You can read every conversation, see where it got stuck, and fix the gap.',
  ],
];

/** What we do not have. Better read here than found out later. */
const HONESTY: Array<[string, string]> = [
  [
    'We are not ISO 27001 certified',
    'A UK competitor is, and charges less than we do. If a certificate is on your procurement checklist, that is a real difference and we are not going to talk you out of it.',
  ],
  [
    'There is no free-forever tier',
    'There is a free trial, and then it costs money. Some tools are free and will stay free. If one website and one inbox is the whole of your customer contact, one of them may be enough.',
  ],
  [
    'There are no customer stories yet',
    'We are new, so you will not find logos, testimonials or star ratings on this page. We are not going to invent them. Set it up, ask it the questions your own customers ask, and judge it on what it says.',
  ],
];

export default async function HomePage() {
  const { plans, trialDays } = await pricing();
  const entry = cheapestPaid(plans);

  return (
    <div className="bg-background">
      {/* Two documents rather than one `@graph`, using the same `JsonLd`
          component the help centre already ships. Reusing it rather than
          writing a second `dangerouslySetInnerHTML` keeps the `<` escaping in
          one place; every value below is ours, none of it is user input. */}
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: 'Switch & Save',
          url: SITE,
          logo: `${SITE}/brand/switch-save-logo.png`,
          address: { '@type': 'PostalAddress', addressCountry: 'GB' },
        }}
      />
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'SoftwareApplication',
          name: 'Switch & Save',
          applicationCategory: 'BusinessApplication',
          operatingSystem: 'Web browser',
          url: SITE,
          description: `${CATEGORY}. AI chat and a shared inbox across your website, WhatsApp, SMS and email, with flat monthly pricing in pounds and data stored in the UK.`,
          publisher: { '@type': 'Organization', name: 'Switch & Save' },
          // Read from the billing catalogue like every other price on the site.
          // `valueAddedTaxIncluded` is not decoration: it is the machine-readable
          // half of VAT_STATEMENT, and it is the difference between our figure
          // and a dollar figure a UK buyer still has tax and conversion to add to.
          offers: plans.map((plan) => ({
            '@type': 'Offer',
            name: plan.label,
            price: String(plan.priceMonthlyGbp),
            priceCurrency: 'GBP',
            url: `${SITE}/pricing`,
            availability: 'https://schema.org/InStock',
            priceSpecification: {
              '@type': 'UnitPriceSpecification',
              price: String(plan.priceMonthlyGbp),
              priceCurrency: 'GBP',
              valueAddedTaxIncluded: true,
              referenceQuantity: {
                '@type': 'QuantitativeValue',
                value: 1,
                unitCode: 'MON',
              },
            },
          })),
        }}
      />

      {/* ------------------------------------------------------------------ */}
      {/* Hero. `bg-brand-sidebar` is the product's one dark decorative
          surface and it is a fixed ramp in both themes, so the text on it uses
          the sidebar foreground tokens rather than a raw white that would only
          work against one of them. Same treatment as /customer-onboarding. */}
      <section className="bg-brand-sidebar text-sidebar-fg">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:py-20">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sidebar-fg-subtle">
              For shops, takeaways, salons and small online stores
            </p>
            <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
              {CATEGORY}
            </h1>
            <p className="mt-5 max-w-xl text-base text-sidebar-fg-muted sm:text-lg">
              An assistant that answers the questions your customers keep asking, on your website and
              on the apps they already message you in. Everything lands in one shared inbox, and your
              team can take over mid-chat.
            </p>

            {/* The price goes above the fold. A reader who has to sign up to
                find out what it costs usually just leaves. */}
            <p className="mt-5 text-sm font-medium sm:text-base">
              {entry
                ? `From ${gbp(entry.priceMonthlyGbp)} a month ${VAT_SHORT}. No fee per seat, and no fee per AI answer.`
                : `Flat monthly pricing in pounds, ${VAT_SHORT}. No fee per seat, and no fee per AI answer.`}
            </p>

            {/* Buttons wrap rather than shrink: at 375px they stack to full
                width instead of squeezing a label onto two lines. */}
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
                <Link href="/pricing">See all packages and prices</Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="ghost"
                className="text-sidebar-fg hover:bg-sidebar-hover hover:text-sidebar-fg"
              >
                <Link href="/customer-onboarding">See how setup works</Link>
              </Button>
            </div>

            <dl className="mt-10 grid gap-3 sm:grid-cols-3">
              {[
                ['Flat pricing', 'One monthly price. Seats and AI answers are in it.'],
                ['Priced in pounds', `${VAT_SHORT}, so the figure is what your card is charged.`],
                ['Stored in the UK', 'Database in London, application server in Manchester.'],
              ].map(([label, detail]) => (
                <div key={label} className="rounded-lg border border-white/15 bg-white/10 p-4">
                  <dt className="text-sm font-semibold">{label}</dt>
                  <dd className="mt-1 text-xs text-sidebar-fg-muted">{detail}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* One column inside the card, sized by the card rather than by the
              viewport: `lg:` measures the window, and this box is at its
              narrowest relative to the window exactly when `lg` first fires. */}
          <figure className="m-0 min-w-0">
            <figcaption className="sr-only">
              An illustration of the shared inbox, showing example questions arriving from three
              channels.
            </figcaption>
            <div className="overflow-hidden rounded-lg border bg-card text-card-foreground shadow-lg">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted px-4 py-3">
                <span className="text-xs font-semibold">One inbox</span>
                <span className="text-xs text-muted-foreground">
                  Website chat and {CHANNEL_COUNT} messaging channels
                </span>
              </div>
              <ul className="divide-y">
                {INBOX_PREVIEW.map(([channel, message, state]) => (
                  <li key={channel} className="p-4">
                    <p className="text-xs font-medium text-muted-foreground">{channel}</p>
                    <p className="mt-1 text-sm">{message}</p>
                    <p className="mt-1 text-xs text-success-fg">{state}</p>
                  </li>
                ))}
              </ul>
              <p className="border-t bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
                An example, not a screenshot. Your team can step in at any point in any of these.
              </p>
            </div>
          </figure>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      <section className="mx-auto max-w-6xl scroll-mt-16 px-5 py-14 sm:px-8" aria-labelledby="what-it-does">
        <div className="max-w-2xl">
          <h2 id="what-it-does" className="text-2xl font-bold tracking-tight sm:text-3xl">
            What it actually does
          </h2>
          <p className="mt-3 text-muted-foreground">
            One assistant, one inbox, and the same answers wherever a customer asks. Everything below
            is in the product today.
          </p>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {CAPABILITIES.map(([title, body]) => (
            <div key={title} className="rounded-lg border bg-card p-5">
              <p className="font-semibold">{title}</p>
              <p className="mt-2 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      <section className="scroll-mt-16 border-y bg-muted/30" aria-labelledby="flat-pricing">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
          <div className="grid gap-8 lg:grid-cols-2">
            <div className="min-w-0">
              <h2 id="flat-pricing" className="text-2xl font-bold tracking-tight sm:text-3xl">
                One price a month, in pounds
              </h2>
              <div className="mt-4 space-y-4 text-muted-foreground">
                <p>{VAT_STATEMENT}</p>
                <p>
                  Most of this market prices AI support one of two ways: a monthly fee for every seat,
                  or a fee for every question the AI resolves. Both mean the bill goes up when your
                  team grows or when you have a busy month, which is exactly when you can least
                  predict it. We do neither. You pick a package and the seats and the AI replies are
                  in it.
                </p>
                <p>
                  Most of those prices are also in dollars, which is a bigger difference than it
                  looks. A price of $29 is not £29 by the time your bank has converted it and added
                  its fee, and VAT is usually still to come on top.
                </p>
                <p>
                  <strong className="text-foreground">
                    Running out does not produce a bill.
                  </strong>{' '}
                  When the monthly allowance is used up the assistant stops writing AI answers and
                  tells the customer somebody will follow up. The message still lands in your inbox
                  for a person to pick up. Nothing is charged to your card unless you switch on
                  automatic top-up yourself.
                </p>
              </div>
              <div className="mt-6">
                <Button asChild size="lg">
                  {/* Deliberately not "ten other products". The comparison
                      table on /pricing is a hand-maintained snapshot of other
                      vendors' price lists, so its length is somebody else's to
                      change and a count typed over here would quietly rot. */}
                  <Link href="/pricing">
                    Compare every package, and what other products charge
                  </Link>
                </Button>
              </div>
            </div>

            <ul className="grid gap-3 sm:grid-cols-2">
              {plans.map((plan) => (
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
                  <p className="mt-1 text-sm text-muted-foreground">
                    {count(plan.seats, 'Unlimited')} team seats
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      <section
        className="mx-auto max-w-6xl scroll-mt-16 px-5 py-14 sm:px-8"
        aria-labelledby="where-data-lives"
      >
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="min-w-0">
            <h2 id="where-data-lives" className="text-2xl font-bold tracking-tight sm:text-3xl">
              Where your data lives
            </h2>
            <p className="mt-3 text-muted-foreground">
              Named places, not the phrase &ldquo;UK hosted&rdquo;. Almost every product in this
              market says that and almost none of them says where.
            </p>
          </div>
          <div className="space-y-4">
            <div className="rounded-lg border bg-card p-5">
              <p className="font-semibold">In the UK</p>
              <p className="mt-2 text-sm text-muted-foreground">{HOSTING_STATEMENT}</p>
            </div>
            {/* The inconvenient half. It is on the pricing page and it is here
                too, because a residency claim with the exception quietly
                removed is the version a buyer finds out about from somebody
                else's sub-processor list. */}
            <div className="rounded-lg border bg-card p-5">
              <p className="font-semibold">Except the model itself</p>
              <p className="mt-2 text-sm text-muted-foreground">{AI_RESIDENCY_STATEMENT}</p>
            </div>
            <p className="text-sm text-muted-foreground">
              What the assistant is told to do, and told never to do, is written out in the{' '}
              <Link
                href="/ai-disclosure"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                AI disclosure
              </Link>
              . What we collect and how long we keep it is in the{' '}
              <Link href="/privacy" className="font-medium text-primary underline-offset-4 hover:underline">
                privacy notice
              </Link>
              .
            </p>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      <section className="scroll-mt-16 border-y bg-muted/30" aria-labelledby="how-setup-works">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
          <div className="max-w-2xl">
            <h2 id="how-setup-works" className="text-2xl font-bold tracking-tight sm:text-3xl">
              Five steps, and no developer
            </h2>
            <p className="mt-3 text-muted-foreground">
              You never have to understand prompts or integrations. You say what you want the
              assistant to do, and it asks you for the facts that answer needs. Each step saves as you
              finish it, so you can stop and come back.
            </p>
          </div>

          {/* The same five steps the product runs, read from `SETUP_STEPS`. A
              retyped copy on the old brochure page had already drifted to four. */}
          <ol className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {SETUP_STEPS.map((step, index) => (
              <li key={step.key} className="flex flex-col rounded-lg border bg-card p-5">
                <span
                  aria-hidden="true"
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
                >
                  {index + 1}
                </span>
                <p className="mt-3 font-semibold">{step.title}</p>
                <p className="mt-2 text-sm text-muted-foreground">{step.description}</p>
              </li>
            ))}
          </ol>

          <div className="mt-6">
            <Button asChild variant="outline">
              <Link href="/customer-onboarding">
                See how setup works, step by step
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      <section className="mx-auto max-w-6xl scroll-mt-16 px-5 py-14 sm:px-8" aria-labelledby="honesty">
        <div className="max-w-2xl">
          <h2 id="honesty" className="text-2xl font-bold tracking-tight sm:text-3xl">
            What we do not have
          </h2>
          <p className="mt-3 text-muted-foreground">
            Three things you would find out in half an hour of looking. You may as well read them
            from us.
          </p>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {HONESTY.map(([title, body]) => (
            <div key={title} className="rounded-lg border bg-card p-5">
              <p className="font-semibold">{title}</p>
              <p className="mt-2 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>

        <p className="mt-6 max-w-3xl text-sm text-muted-foreground">
          The longer version, including what the other products in this market charge and where each
          of them genuinely beats us, is on the{' '}
          <Link href="/pricing" className="font-medium text-primary underline-offset-4 hover:underline">
            pricing page
          </Link>
          .
        </p>
      </section>

      {/* ------------------------------------------------------------------ */}
      <section className="border-t bg-muted/30" aria-labelledby="start">
        <div className="mx-auto max-w-3xl px-5 py-14 text-center sm:px-8">
          <h2 id="start" className="text-2xl font-bold tracking-tight sm:text-3xl">
            {trialDays ? `Try it free for ${trialDays} days.` : 'Try it free before you pay anything.'}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            Set it up, ask it the questions your customers ask, and see what it says before you decide
            it is worth {entry ? gbp(entry.priceMonthlyGbp) : 'anything'} a month. No card, no call, no
            installation appointment.
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
