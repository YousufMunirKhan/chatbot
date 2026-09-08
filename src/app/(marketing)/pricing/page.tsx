import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CHANNEL_KEYS } from '@/lib/channels/types';
import {
  AI_RESIDENCY_STATEMENT,
  HOSTING_STATEMENT,
  VAT_SHORT,
  VAT_STATEMENT,
  count,
  gbp,
  getPublicPricing,
  type PublicPlan,
} from './plan-catalogue';

/**
 * The public pricing page.
 *
 * ANONYMOUS BY DESIGN
 * A stranger with no account has to be able to find out what this costs, which
 * until now they could not: the only place a price appeared was inside the
 * dashboard, after signing up. Nothing on this page touches a session.
 *
 * EVERY NUMBER IS READ, NOT TYPED
 * The prices, allowances and limits come from `./plan-catalogue`, which reads
 * the same billing catalogue the dashboard billing page and Stripe checkout
 * read. See the long comment in that file for why the table beats the code
 * constants. The only numbers written into this file by hand are competitors'
 * published prices, which are dated and attributed below.
 *
 * WHO THIS IS AIMED AT
 * Not at anyone weighing up Intercom. A UK small business's incumbent is the
 * free WhatsApp Business app, a free live-chat widget, or nothing at all, and
 * Intercom at $534/mo was never competing for that budget. The comparison
 * section is therefore honest in both directions: free tools now answer with AI
 * too, one competitor is both cheaper and better certified than we are, and
 * saying so is worth more than pretending otherwise to a reader who can check
 * in thirty seconds.
 */

export const runtime = 'nodejs';
// Prices are read live so the page cannot advertise a figure the billing
// catalogue no longer holds. Caching this would reintroduce exactly the drift
// the whole page is built to avoid.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Pricing — Switch & Save AI Assistant',
  description:
    'Simple monthly pricing in pounds, VAT included, with your data hosted in London. AI chat across your website and ten messaging channels, with a shared inbox and human handoff.',
};

/** Messaging channels, counted rather than claimed — see `@/lib/channels/types`. */
const CHANNEL_COUNT = CHANNEL_KEYS.length;

/**
 * Competitor pricing, from each vendor's own published page, September 2026.
 *
 * Kept as flat data with the date attached because it is the one part of this
 * page that cannot be read from anything: it is a snapshot of somebody else's
 * price list and it will rot. `beatsUs` is not decoration — a comparison table
 * where every row loses is a table nobody believes, and two of these vendors
 * genuinely win on things a careful buyer should weigh.
 */
interface Competitor {
  name: string;
  price: string;
  /** What that figure buys, in their units, not ours. */
  basis: string;
  beatsUs: string | null;
}

const COMPETITORS: Competitor[] = [
  {
    name: 'Tawk.to',
    price: 'Free',
    basis: 'Free live chat, and it now answers with AI over your own content.',
    beatsUs: 'Free, with no cap to run into. If a single chat widget is all you need, this is enough.',
  },
  {
    name: 'Shopify Inbox',
    price: 'Free',
    basis: 'Free with a Shopify plan, and it answers with AI over your store content.',
    beatsUs: 'Free, and already knows your Shopify catalogue without being connected to anything.',
  },
  {
    name: 'Click4Assistance',
    price: '£19.95/mo',
    basis: 'UK-hosted live chat. The AI agent is an unpriced "contact us" at every tier below Enterprise.',
    beatsUs: 'Cheaper than our entry package, also UK-hosted, and ISO 27001:2022 certified — which we are not.',
  },
  {
    name: 'Tidio',
    price: '$29/mo, or ~$700/mo with AI',
    basis: 'Starter is $29. 1,000 Lyro AI conversations is about $700/mo.',
    beatsUs: null,
  },
  {
    name: 'Chatbase',
    price: '$40–$150/mo',
    basis: '$40 for 700 message credits, $150 for 4,000. One Sonnet reply spends 3 credits.',
    beatsUs: null,
  },
  {
    name: 'Crisp',
    price: '$45–$95/mo',
    basis: 'Mini is $45 per workspace, Essentials $95.',
    beatsUs: null,
  },
  {
    name: 'Revora',
    price: '$149–$299/mo',
    basis: 'Growth is $149 for 500 AI sessions, Pro $299. USD only.',
    beatsUs: 'Arabic-first, if that is the language your customers write in.',
  },
  {
    name: 'Freshworks',
    price: 'Per seat, plus $0.49 per AI session',
    basis: 'AI sessions are charged on top of per-agent seat fees.',
    beatsUs: null,
  },
  {
    name: 'Intercom',
    price: '~$534/mo at 500 resolutions',
    basis: '$39 per seat per month, plus $0.99 for every resolution from the first. No free plan.',
    beatsUs: 'A far bigger product, if you have the team and the budget to run it.',
  },
  {
    name: 'Gorgias',
    price: '~$782/mo',
    basis: 'At a comparable monthly volume.',
    beatsUs: 'Deep, mature ecommerce helpdesk tooling.',
  },
];

/** What we do not have, listed before a buyer has to ask. */
const HONEST_GAPS: Array<[string, string]> = [
  [
    'We are not ISO 27001 certified',
    'Click4Assistance is, at £19.95 a month. If a certificate is on your procurement checklist, that is a real difference and we are not going to talk you out of it.',
  ],
  [
    'There is no free-forever tier',
    'There is a free trial, and then it costs money. Tawk.to and Shopify Inbox are free and will stay free.',
  ],
  [
    'The AI itself is not hosted in the UK',
    'Your data is. The model that writes the answer is not — see below, in full.',
  ],
];

/** The things a free tool cannot do, which is where the money actually goes. */
const WHAT_THE_MONEY_BUYS: Array<[string, string]> = [
  [
    `Website chat plus ${CHANNEL_COUNT} messaging channels`,
    'WhatsApp, Instagram, Facebook, Telegram, Viber, LINE, TikTok, YouTube, SMS and email all land in one place, answered by one assistant that knows the same things everywhere.',
  ],
  [
    'One shared inbox, with a person able to step in',
    'Your team sees every conversation from every channel in a single inbox and can take over mid-chat. The free apps each keep their own separate inbox, and none of them hand over to a colleague.',
  ],
  [
    'It knows your products, stock and orders',
    'Connect Shopify or WooCommerce — or upload a CSV, or point it at your own API — and it answers "is this in stock" and "where is my order" from live data instead of guessing.',
  ],
  [
    'It plugs into the rest of your business',
    'API keys and webhooks, so Zapier or your own system can read and write leads, conversations and orders. A free widget is a dead end by design.',
  ],
  [
    'Guided chats and bookings, not just answers',
    'Take a booking, capture a lead with the fields you actually need, and run the same conversation the same way every time.',
  ],
  [
    'It says "I do not know"',
    'It answers from your business information and your help articles. You can read every conversation, see where it got stuck, and fix the gap.',
  ],
];

const FAQS: Array<[string, React.ReactNode]> = [
  [
    'What counts as an AI reply?',
    <>
      One message written by the assistant. A customer asking four questions in one conversation uses
      four. Messages your own team types in the inbox are free and unlimited — you are never charged
      for a human answering a human.
    </>,
  ],
  [
    'What happens when I run out?',
    <>
      Nothing gets charged to your card. The assistant stops writing AI answers, tells the customer a
      team member will follow up, and the message still lands in your inbox for someone to pick up. No
      overage bill, no surprise invoice. If you would rather it kept answering, you can switch on
      automatic top-up — off by default, and it is your choice to turn on.
    </>,
  ],
  [
    'Is VAT extra?',
    <>{VAT_STATEMENT}</>,
  ],
  [
    'Do I need a developer?',
    <>
      No. Setup asks what the assistant should do and what your business does, then gives you one line
      of code to paste into your website — Wix, Squarespace, WordPress, Shopify or a hand-built site.
      If you have a developer, there is a REST API and webhooks waiting for them.
    </>,
  ],
  [
    'Can I cancel?',
    <>
      Yes, from the billing page, any month. Cancelling stops the renewal and you keep everything until
      the end of the period you have already paid for. Invoices, cards and cancellation are handled on
      Stripe&rsquo;s own pages — this app never sees your card number.
    </>,
  ],
  [
    'Can I change package later?',
    <>
      Up or down, whenever. The allowance and the features change with it, and what your package
      includes is spelled out on your billing page — the same list you are reading here.
    </>,
  ],
];

export default async function PricingPage() {
  const pricing = await getPublicPricing();
  const { plans, custom, trialDays, source } = pricing;

  // The headline price is the cheapest package anyone can actually buy, found
  // rather than written, so an operator repricing the catalogue reprices the
  // headline too.
  const paid = plans.filter((plan) => plan.priceMonthlyGbp > 0);
  const entry = paid.reduce<PublicPlan | null>(
    (cheapest, plan) => (!cheapest || plan.priceMonthlyGbp < cheapest.priceMonthlyGbp ? plan : cheapest),
    null,
  );

  // Only one card can wear it, and it should be the middle paid package rather
  // than a hand-picked key: the catalogue is editable and `growth` may not
  // always be the one in the middle.
  const popular = paid.length > 2 ? paid[Math.floor(paid.length / 2)] : null;

  return (
    <div className="bg-background">
      {/* ------------------------------------------------------------------ */}
      <section className="border-b bg-muted/30">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-20">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Pricing</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            {entry ? (
              <>
                An assistant that answers your customers, from {gbp(entry.priceMonthlyGbp)} a month.
              </>
            ) : (
              <>An assistant that answers your customers, priced in pounds.</>
            )}
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
            In pounds, {VAT_SHORT}, with your data stored in London. It answers on your website and on{' '}
            {CHANNEL_COUNT} messaging channels, and hands over to a person the moment it should.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/signup">
                {trialDays ? `Start your ${trialDays}-day free trial` : 'Start free'}
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/customer-onboarding">See how setup works</Link>
            </Button>
          </div>

          <ul className="mt-10 grid gap-3 sm:grid-cols-3">
            {[
              ['Priced in pounds', `${VAT_SHORT}. No seat fees, no charge per conversation.`],
              ['Hosted in London', 'Your account, chats and business data stay in the UK.'],
              ['No surprise bill', 'Run out of AI replies and it stops, rather than billing you.'],
            ].map(([title, body]) => (
              <li key={title} className="rounded-lg border bg-card p-4">
                <p className="text-sm font-semibold">{title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      <section className="mx-auto max-w-6xl scroll-mt-16 px-5 py-14 sm:px-8" aria-labelledby="packages">
        <h2 id="packages" className="text-3xl font-bold tracking-tight">
          Packages
        </h2>
        <p className="mt-2 max-w-2xl text-muted-foreground">{VAT_STATEMENT}</p>

        {/* Four cards in a 1,152px column is ~270px each, which is enough for a
            price and a short list but not for a wide one — hence two columns
            until xl rather than a four-column grid that squeezes at lg. */}
        <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {plans.map((plan) => (
            <PlanCard key={plan.key} plan={plan} highlighted={popular?.key === plan.key} />
          ))}
        </div>

        <div className="mt-6 rounded-lg border bg-muted/40 p-5">
          <p className="font-semibold">{custom.label}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {custom.description} Priced per company rather than per card — tell us the volume and what
            it has to connect to, and you get a written quote.
          </p>
        </div>

        {source === 'fallback' ? (
          // Said out loud rather than hidden. These are the seeded catalogue
          // prices, which are almost always right — but "almost always" is not
          // a promise to make about money, so the page steps back from it.
          <p className="mt-4 text-sm text-muted-foreground">
            We could not reach the live billing catalogue just now, so these are our standard published
            prices. Your exact price is always confirmed before you pay anything.
          </p>
        ) : null}
      </section>

      {/* ------------------------------------------------------------------ */}
      <section className="scroll-mt-16 border-y bg-muted/30" aria-labelledby="compare-packages">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
          <h2 id="compare-packages" className="text-3xl font-bold tracking-tight">
            What each package includes
          </h2>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            The same list your billing page shows once you are inside, because it is read from the same
            catalogue.
          </p>

          <p className="mt-4 text-sm text-muted-foreground md:hidden">
            The table scrolls sideways — drag it, or swipe.
          </p>
          {/* Wide table, so it scrolls inside its own box rather than pushing
              the page sideways on a phone. `tabIndex` and the region role are
              WCAG 2.1.1: a scroll container that only a mouse or a finger can
              move is content a keyboard user cannot reach. */}
          <div
            className="mt-4 overflow-x-auto rounded-lg border bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            tabIndex={0}
            role="region"
            aria-label="What each package includes"
          >
            <table className="w-full min-w-[46rem] border-collapse text-sm">
              <caption className="sr-only">
                Features and monthly allowances included with each package
              </caption>
              <thead>
                <tr className="border-b bg-muted/50 text-start">
                  <th scope="col" className="p-3 font-semibold">
                    Feature
                  </th>
                  {plans.map((plan) => (
                    <th key={plan.key} scope="col" className="p-3 text-center font-semibold">
                      {plan.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <MatrixNumberRow
                  label="Price per month"
                  plans={plans}
                  render={(plan) =>
                    plan.priceMonthlyGbp === 0 ? 'Free' : `${gbp(plan.priceMonthlyGbp)} ${VAT_SHORT}`
                  }
                />
                <MatrixNumberRow
                  label="AI replies each month"
                  plans={plans}
                  render={(plan) => count(plan.monthlyReplies)}
                />
                {/* "Unmetered" is the right word for replies and the wrong one
                    for a countable thing, so the countable rows say
                    "Unlimited" — and say it identically to the cards above. */}
                <MatrixNumberRow
                  label="Assistants"
                  plans={plans}
                  render={(plan) => count(plan.assistants, 'Unlimited')}
                />
                <MatrixNumberRow
                  label="Team seats"
                  plans={plans}
                  render={(plan) => count(plan.seats, 'Unlimited')}
                />
                <MatrixNumberRow
                  label="Connected systems"
                  plans={plans}
                  render={(plan) => count(plan.integrations, 'Unlimited')}
                />
                {/* Feature rows are driven off the first package's list, which
                    is safe because every package is built from the same
                    `PLAN_FEATURES` array in the same order. */}
                {(plans[0]?.features ?? []).map((row, index) => (
                  <tr key={row.feature} className="border-b last:border-0">
                    <th scope="row" className="p-3 text-start font-normal">
                      <span className="font-medium">{row.label}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {row.description}
                      </span>
                    </th>
                    {plans.map((plan) => {
                      const cell = plan.features[index];
                      return (
                        <td key={plan.key} className="p-3 text-center">
                          <Tick on={cell?.included ?? false} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      <section className="mx-auto max-w-6xl scroll-mt-16 px-5 py-14 sm:px-8" aria-labelledby="vs-free">
        <h2 id="vs-free" className="text-3xl font-bold tracking-tight">
          You are probably using something free right now
        </h2>
        <div className="mt-4 max-w-3xl space-y-4 text-muted-foreground">
          <p>
            Most small businesses we talk to are on the free WhatsApp Business app, a free chat widget,
            or nothing but an inbox and a phone. That is the honest comparison, so here it is.
          </p>
          <p>
            <strong className="text-foreground">Free tools do answer with AI now.</strong> Shopify
            Inbox and Meta&rsquo;s own assistant both write replies from your content, and they are
            good at it. If one website and one inbox is the whole of your customer contact, a free tool
            may genuinely be enough, and we would rather say that than sell you something you do not
            need.
          </p>
          <p>
            What none of them do is the second half of the job: pull every channel into one place, know
            your live stock and orders, hand a conversation to a colleague, and connect to the rest of
            your systems. That is what the money is for.
          </p>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {WHAT_THE_MONEY_BUYS.map(([title, body]) => (
            <div key={title} className="rounded-lg border bg-card p-5">
              <p className="font-semibold">{title}</p>
              <p className="mt-2 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      <section className="scroll-mt-16 border-y bg-muted/30" aria-labelledby="vs-others">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
          <h2 id="vs-others" className="text-3xl font-bold tracking-tight">
            What everyone else charges
          </h2>
          <p className="mt-2 max-w-3xl text-muted-foreground">
            Taken from each vendor&rsquo;s own published pricing in September 2026. Prices change and
            ours is the only one we control — check theirs before you decide. Dollar prices are the
            vendor&rsquo;s own: your bank converts them and adds its fee.
          </p>

          <p className="mt-4 text-sm text-muted-foreground md:hidden">
            The table scrolls sideways — drag it, or swipe.
          </p>
          <div
            className="mt-4 overflow-x-auto rounded-lg border bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            tabIndex={0}
            role="region"
            aria-label="Published monthly pricing for comparable products"
          >
            <table className="w-full min-w-[44rem] border-collapse text-sm">
              <caption className="sr-only">
                Published monthly pricing for comparable products, September 2026
              </caption>
              <thead>
                <tr className="border-b bg-muted/50 text-start">
                  <th scope="col" className="p-3 font-semibold">
                    Product
                  </th>
                  <th scope="col" className="p-3 font-semibold">
                    Published price
                  </th>
                  <th scope="col" className="p-3 font-semibold">
                    What that buys, and where they beat us
                  </th>
                </tr>
              </thead>
              <tbody>
                {entry ? (
                  <tr className="border-b bg-primary/5">
                    <th scope="row" className="p-3 text-start font-semibold">
                      Switch &amp; Save
                      <Badge variant="info" className="ms-2 align-middle">
                        This is us
                      </Badge>
                    </th>
                    <td className="p-3 font-medium">
                      {gbp(entry.priceMonthlyGbp)}/mo {VAT_SHORT}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {count(entry.monthlyReplies)} AI replies a month on {entry.label}, in pounds,
                      hosted in London. We are not certified to ISO 27001 and we have no free tier.
                    </td>
                  </tr>
                ) : null}
                {COMPETITORS.map((row) => (
                  <tr key={row.name} className="border-b last:border-0">
                    <th scope="row" className="p-3 text-start font-medium">
                      {row.name}
                    </th>
                    <td className="p-3">{row.price}</td>
                    <td className="p-3 text-muted-foreground">
                      {row.basis}
                      {row.beatsUs ? (
                        <span className="mt-1 block text-foreground">
                          <span className="font-medium">Beats us:</span> {row.beatsUs}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-8">
            <h3 className="text-xl font-semibold tracking-tight">Where we lose</h3>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {HONEST_GAPS.map(([title, body]) => (
                <div key={title} className="rounded-lg border border-warning-border bg-warning-bg p-5">
                  <p className="font-semibold text-warning-fg">{title}</p>
                  <p className="mt-2 text-sm text-warning-fg">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      <section className="mx-auto max-w-6xl scroll-mt-16 px-5 py-14 sm:px-8" aria-labelledby="where-data-lives">
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <h2 id="where-data-lives" className="text-3xl font-bold tracking-tight">
              Where your data lives
            </h2>
            <p className="mt-3 text-muted-foreground">
              Almost none of the products above will tell you this on their pricing page, so it is on
              ours.
            </p>
          </div>
          <div className="space-y-4">
            <div className="rounded-lg border bg-card p-5">
              <p className="font-semibold">In the UK</p>
              <p className="mt-2 text-sm text-muted-foreground">{HOSTING_STATEMENT}</p>
            </div>
            <div className="rounded-lg border bg-card p-5">
              <p className="font-semibold">Except the model, and here is the detail</p>
              <p className="mt-2 text-sm text-muted-foreground">{AI_RESIDENCY_STATEMENT}</p>
            </div>
            <p className="text-sm text-muted-foreground">
              What we collect, how long we keep it and how to get it back is written out in the{' '}
              <Link href="/privacy" className="font-medium text-primary underline-offset-4 hover:underline">
                privacy notice
              </Link>{' '}
              and the{' '}
              <Link
                href="/data-processing"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                data processing terms
              </Link>
              . How the assistant uses AI, and what it is told not to do, is in the{' '}
              <Link
                href="/ai-disclosure"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                AI disclosure
              </Link>
              .
            </p>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      <section className="scroll-mt-16 border-t bg-muted/30" aria-labelledby="faq">
        <div className="mx-auto max-w-4xl px-5 py-14 sm:px-8">
          <h2 id="faq" className="text-3xl font-bold tracking-tight">
            Questions people actually ask
          </h2>
          <dl className="mt-8 space-y-6">
            {FAQS.map(([question, answer]) => (
              <div key={question} className="rounded-lg border bg-card p-5">
                <dt className="font-semibold">{question}</dt>
                <dd className="mt-2 text-sm text-muted-foreground">{answer}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-10 rounded-lg border bg-card p-6 text-center">
            <p className="text-xl font-bold">
              {trialDays
                ? `Try it free for ${trialDays} days.`
                : 'Try it free before you pay anything.'}
            </p>
            <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
              Set it up, ask it the questions your customers ask, and see what it says before you decide
              it is worth {entry ? gbp(entry.priceMonthlyGbp) : 'anything'} a month.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <Button asChild size="lg">
                <Link href="/signup">Start free</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/customer-onboarding">See how setup works</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function PlanCard({ plan, highlighted }: { plan: PublicPlan; highlighted: boolean }) {
  const free = plan.priceMonthlyGbp === 0;
  const included = plan.features.filter((feature) => feature.included);

  return (
    <div
      className={
        highlighted
          ? 'flex flex-col rounded-lg border-2 border-primary bg-card p-5'
          : 'flex flex-col rounded-lg border bg-card p-5'
      }
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-bold">{plan.label}</h3>
        {highlighted ? <Badge>Most chosen</Badge> : null}
      </div>

      <p className="mt-4">
        <span className="text-3xl font-extrabold tracking-tight">
          {free ? 'Free' : gbp(plan.priceMonthlyGbp)}
        </span>
        {free ? null : (
          <>
            <span className="text-muted-foreground">/month</span>{' '}
            <span className="text-sm text-muted-foreground">{VAT_SHORT}</span>
          </>
        )}
      </p>
      {free && plan.trialDays ? (
        <p className="mt-1 text-sm text-muted-foreground">for {plan.trialDays} days</p>
      ) : null}

      <p className="mt-3 text-sm text-muted-foreground">{plan.description}</p>

      <dl className="mt-5 space-y-2 border-t pt-4 text-sm">
        <Spec label="AI replies a month" value={count(plan.monthlyReplies)} />
        <Spec label="Assistants" value={count(plan.assistants, 'Unlimited')} />
        <Spec label="Team seats" value={count(plan.seats, 'Unlimited')} />
        <Spec label="Connected systems" value={count(plan.integrations, 'Unlimited')} />
      </dl>

      <div className="mt-4 border-t pt-4 text-sm">
        {included.length === 0 ? (
          // Every package answers on the website, shares one inbox and hands
          // over to a person; the ticks are only the extras a package adds on
          // top, so a package with no extras still has to say what it does.
          <p className="text-muted-foreground">Website chat, shared inbox and human handoff.</p>
        ) : (
          <>
            <p className="font-medium">Adds</p>
            <ul className="mt-2 space-y-1.5">
              {included.map((feature) => (
                <li key={feature.feature} className="flex items-start gap-2">
                  {/* Decorative here: the heading above already says these are
                      included, so repeating "Included" on every row would make
                      a screen reader read the word six times. */}
                  <span aria-hidden="true" className="text-success-fg">
                    ✓
                  </span>
                  <span>{feature.label}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* `mt-auto` is what makes four cards of different lengths line their
          buttons up. Without it the "Most chosen" card, which carries the most
          feature rows, put its button 60px below its neighbours' — the one
          control on the page a buyer is looking for, in four different places. */}
      <div className="mt-auto pt-5">
        <Button asChild className="w-full" variant={highlighted ? 'default' : 'outline'}>
          <Link href="/signup">{free ? 'Start free' : `Choose ${plan.label}`}</Link>
        </Button>
      </div>
    </div>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function MatrixNumberRow({
  label,
  plans,
  render,
}: {
  label: string;
  plans: PublicPlan[];
  render: (plan: PublicPlan) => string;
}) {
  return (
    <tr className="border-b">
      <th scope="row" className="p-3 text-start font-medium">
        {label}
      </th>
      {plans.map((plan) => (
        <td key={plan.key} className="p-3 text-center">
          {render(plan)}
        </td>
      ))}
    </tr>
  );
}

/**
 * Included / not included.
 *
 * The word is in the markup rather than only in the colour, so the table means
 * the same thing to a screen reader and to anyone who cannot separate the green
 * from the grey.
 */
function Tick({ on }: { on: boolean }) {
  return on ? (
    <span className="inline-flex items-center gap-1 text-success-fg">
      <span aria-hidden="true">✓</span>
      <span className="sr-only">Included</span>
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <span aria-hidden="true">—</span>
      <span className="sr-only">Not included</span>
    </span>
  );
}
