import Image from 'next/image';
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
} from '@/app/(marketing)/pricing/plan-catalogue';

// The journey shown here is the journey the product actually runs. It used to
// be a retyped copy that had already drifted — four steps against the product's
// five, with "try it" and "install" merged — so a visitor was promised one
// thing and given another.
const journey = SETUP_STEPS.map((step) => [step.title, step.description] as const);

const integrations = [
  ['Website', 'Paste the widget snippet into any site builder or custom site.'],
  ['Custom systems', 'Connect .NET, Node, PHP, JavaScript, mobile, or ERP apps through REST API and webhooks.'],
  ['No developer fallback', 'Upload CSV files for products, inventory, orders, customers, or menus.'],
];

export const runtime = 'nodejs';
// This page now quotes a real price, and a price is only worth quoting if it is
// the live one. Reading the billing catalogue makes the page dynamic; caching it
// would let the brochure advertise a figure the checkout no longer honours.
export const dynamic = 'force-dynamic';

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
    <main className="min-h-screen bg-[#f4f7fb] text-slate-950">
      <section className="bg-brand-sidebar text-white">
        <div className="mx-auto grid min-h-[92vh] max-w-7xl gap-10 px-5 py-6 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:px-10">
          <div className="flex flex-col">
            <div className="inline-flex w-fit rounded-2xl bg-white p-4 shadow-2xl shadow-blue-950/20">
              <Image src="/brand/switch-save-logo.png" alt="Switch & Save" width={260} height={52} priority className="h-auto w-64" />
            </div>

            <div className="mt-14 max-w-xl">
              <p className="text-sm font-bold uppercase tracking-[0.22em] text-blue-100">AI assistant onboarding</p>
              <h1 className="mt-4 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
                Launch a useful assistant without technical confusion.
              </h1>
              <p className="mt-5 text-lg font-medium text-blue-100">
                A guided setup asks what the assistant should do, collects only the required business data, then gives a simple website install path.
              </p>
              {/* The price belongs above the fold, not behind the signup form.
                  A reader who has to create an account to find out what it costs
                  usually just leaves. */}
              <p className="mt-4 text-base font-semibold text-white">
                {entry
                  ? `From ${gbp(entry.priceMonthlyGbp)} a month ${VAT_SHORT}, hosted in London.`
                  : 'Priced in pounds, hosted in London.'}{' '}
                <Link href="/pricing" className="underline underline-offset-4 hover:text-blue-100">
                  See all packages
                </Link>
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                {/* This page describes the setup journey and then, until
                    self-serve signup existed, sent the reader to a login form
                    they had no way past. */}
                <Button asChild size="lg" className="bg-white text-slate-950 hover:bg-blue-50">
                  <Link href="/signup">
                    {trialDays ? `Start free for ${trialDays} days` : 'Start free'}
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="border-white/35 bg-white/10 text-white hover:bg-white/15">
                  <Link href="/pricing">See pricing</Link>
                </Button>
                <Button asChild size="lg" variant="ghost" className="text-white hover:bg-white/15 hover:text-white">
                  <Link href="/login">I already have an account</Link>
                </Button>
              </div>
            </div>

            <div className="mt-auto grid gap-3 pt-10 sm:grid-cols-3">
              {/* These used to all say "Built into onboarding", which told a
                  reader nothing. Each one now carries the fact behind it. */}
              {[
                ['No-code launch', 'One line of code on your site'],
                ['Human handoff', 'Your team takes over mid-chat'],
                ['Priced in pounds', `${VAT_SHORT}, and no charge per conversation`],
              ].map(([label, detail]) => (
                <div key={label} className="rounded-lg border border-white/15 bg-white/10 p-4 backdrop-blur">
                  <div className="text-sm font-bold">{label}</div>
                  <div className="mt-1 text-xs font-medium text-blue-100">{detail}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center">
            <div className="w-full overflow-hidden rounded-xl border border-white/15 bg-white text-slate-950 shadow-2xl shadow-blue-950/30">
              <div className="flex items-center gap-2 border-b bg-slate-100 px-4 py-3">
                <span className="h-3 w-3 rounded-full bg-red-400" />
                <span className="h-3 w-3 rounded-full bg-amber-400" />
                <span className="h-3 w-3 rounded-full bg-emerald-400" />
                <span className="ml-3 text-xs font-medium text-slate-500">switchandsave.ai/company/setup</span>
              </div>
              <div className="grid gap-0 lg:grid-cols-[0.7fr_1fr]">
                <div className="border-b bg-slate-50 p-4 lg:border-b-0 lg:border-r">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Saved progress</p>
                  <div className="mt-4 space-y-2">
                    {journey.map(([title], index) => (
                      <div key={title} className="flex items-center gap-3 rounded-md border bg-white p-3">
                        <span className={index < 2 ? 'flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-xs font-black text-emerald-700' : 'flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-xs font-black text-blue-700'}>
                          {index < 2 ? 'OK' : index + 1}
                        </span>
                        <span className="text-sm font-semibold">{title}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="p-5">
                  <div className="flex items-center justify-between">
                    <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-700">60% ready</span>
                    <span className="text-xs font-medium text-slate-500">Continue where you left off</span>
                  </div>
                  <h2 className="mt-5 text-2xl font-bold">Required business data</h2>
                  <p className="mt-2 text-sm text-slate-600">
                    Because sales and booking are enabled, the setup asks for services, pricing, hours, location, lead fields, and appointment rules.
                  </p>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    {['Services', 'Business hours', 'FAQs', 'Booking rules'].map((item) => (
                      <div key={item} className="rounded-md border p-3">
                        <p className="text-sm font-semibold">{item}</p>
                        <p className="mt-1 text-xs text-emerald-700">Ready to edit</p>
                      </div>
                    ))}
                  </div>
                  <pre className="mt-5 overflow-x-auto rounded-md bg-slate-950 p-4 text-xs text-blue-100">{`<script
  src="https://switchandsave.ai/widget.js"
  data-bot="your-public-bot-id">
</script>`}</pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-14 sm:px-8 lg:px-10">
        <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">The setup asks the right questions.</h2>
            <p className="mt-3 text-slate-600">
              Customers do not need to understand prompts, RAG, tools, or integrations. They choose the outcome, and the platform asks for the matching data.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {journey.map(([title, text]) => (
              <div key={title} className="rounded-lg border bg-white p-5 shadow-sm">
                <p className="font-semibold">{title}</p>
                <p className="mt-2 text-sm text-slate-600">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y bg-white">
        <div className="mx-auto max-w-7xl px-5 py-14 sm:px-8 lg:px-10">
          <h2 className="text-3xl font-bold tracking-tight">Integration is simple, but not shallow.</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {integrations.map(([title, text]) => (
              <div key={title} className="rounded-lg border p-5">
                <p className="font-semibold">{title}</p>
                <p className="mt-2 text-sm text-slate-600">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* The end of the brochure is where a reader decides, and until now it
          ended without ever naming a price or saying where the data sits. Both
          answers are here, and both are read from the same catalogue the
          checkout charges from rather than written into this file. */}
      <section className="mx-auto max-w-7xl px-5 py-14 sm:px-8 lg:px-10">
        <div className="grid gap-8 lg:grid-cols-[1fr_1fr]">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">What it costs, and where it lives.</h2>
            <p className="mt-3 text-slate-600">{VAT_STATEMENT}</p>
            <p className="mt-3 text-slate-600">{HOSTING_STATEMENT}</p>
            <div className="mt-6">
              <Button asChild size="lg">
                <Link href="/pricing">See the full price list</Link>
              </Button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {plans.slice(0, 4).map((plan) => (
              <div key={plan.key} className="rounded-lg border bg-white p-5 shadow-sm">
                <p className="font-semibold">{plan.label}</p>
                <p className="mt-1 text-2xl font-extrabold tracking-tight">
                  {plan.priceMonthlyGbp === 0 ? 'Free' : gbp(plan.priceMonthlyGbp)}
                  {plan.priceMonthlyGbp === 0 ? null : (
                    <span className="text-sm font-medium text-slate-500">/mo</span>
                  )}
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  {count(plan.monthlyReplies)} AI replies a month
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
