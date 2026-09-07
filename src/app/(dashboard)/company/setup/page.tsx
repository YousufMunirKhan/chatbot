import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { getCompanySetupProgress, type CompanySetupProgress, type SetupStep } from '@/modules/company/setup-data';
import { TestAssistant } from '@/modules/company/components/test-assistant';
import { WebsiteOnboardingForm } from '@/modules/company/components/website-onboarding-form';

/**
 * "What do I do next?" — the whole page.
 *
 * WHAT THIS REPLACED
 * ------------------
 * The page used to open with a readiness percentage, a progress bar, and four
 * counters (`Assistants 1`, `Knowledge docs 3`, `Team members 2`, `Your business
 * details 40%`). None of it told a new owner what to do; a percentage in
 * particular is a score, and a score on your first afternoon is discouraging
 * rather than useful. Below that, an interactive wizard listed the same five
 * steps a second time, in a client component with its own localStorage cursor.
 *
 * So: one ordered checklist, rendered on the server, with exactly one button on
 * it — the next thing to do. Finished steps stay visible and re-openable,
 * because "what did I already set up?" is the second question people ask, but
 * they are quiet. The steps, their titles and their completion all still come
 * from `getCompanySetupProgress()`, unchanged: this is a different presentation
 * of the same data, not different data.
 *
 * `/company` (home) runs off the same `nextStep`, so the two screens can never
 * disagree about what comes next.
 */

/**
 * The one extra sentence per step: what you will actually be doing when you get
 * there. `step.description` says what the step is for; this says what the work
 * feels like, which is the part that stops someone putting it off. Carried over
 * from the wizard this page used to render underneath itself.
 */
const STEP_GUIDANCE: Record<string, string> = {
  purpose:
    'Choose who it talks to — the people on your website, or your own staff. You can have one of each.',
  capabilities:
    'Tick only what you want it doing today. You can turn more on any time, and nothing you leave off is lost.',
  'required-data':
    'Import your website first if you have one, then fill the gaps: what you sell, when you are open, and the answers you find yourself repeating.',
  test: 'Ask it the questions your customers really ask — including one it cannot possibly know, to check it says so instead of making something up.',
  install:
    'Add your web address and paste one line of code into your site. Whoever built your website will know where it goes.',
};

/** The click, in the owner's voice. The step titles describe the job. */
const STEP_CTA: Record<string, string> = {
  purpose: 'Create my assistant',
  capabilities: 'Pick the jobs',
  'required-data': 'Add my details',
  test: 'Try it now',
  install: 'Get my website code',
};

function ChecklistRow({
  step,
  index,
  isNext,
}: {
  step: SetupStep;
  index: number;
  isNext: boolean;
}) {
  return (
    <li
      aria-current={isNext ? 'step' : undefined}
      className={[
        'flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:gap-4',
        // Colour is never the only signal: the current step also carries
        // aria-current, the word "Do this next", and the only solid button.
        isNext ? 'bg-muted/40' : undefined,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span
        aria-hidden="true"
        className={[
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-sm font-semibold tabular-nums',
          step.complete
            ? 'border-success-border bg-success-bg text-success-fg'
            : isNext
              ? 'border-transparent bg-primary text-primary-foreground'
              : 'text-muted-foreground',
        ].join(' ')}
      >
        {step.complete ? '✓' : index + 1}
      </span>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className={step.complete ? 'font-medium text-muted-foreground' : 'font-medium'}>
            {step.title}
          </p>
          {step.complete ? (
            <Badge variant="success">Done</Badge>
          ) : isNext ? (
            <Badge variant="secondary">Do this next</Badge>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {step.complete ? step.detail : (STEP_GUIDANCE[step.key] ?? step.description)}
        </p>
      </div>

      <div className="shrink-0">
        {step.complete ? (
          <Button asChild size="sm" variant="ghost">
            <Link href={step.href}>Change this</Link>
          </Button>
        ) : isNext ? (
          <Button asChild size="sm">
            <Link href={step.href}>{STEP_CTA[step.key] ?? 'Start'}</Link>
          </Button>
        ) : (
          <Button asChild size="sm" variant="outline">
            <Link href={step.href}>Open</Link>
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * What to do once the five are done.
 *
 * Deliberately not steps six to eight: none of it is required, and putting it in
 * the checklist would make a finished set-up look unfinished forever.
 */
const NEXT_MOVES: { href: string; title: string; body: string }[] = [
  {
    href: '/company/channels',
    title: 'Answer on WhatsApp too',
    body: 'Connect WhatsApp, Messenger or Instagram and the same assistant replies there, in the same inbox.',
  },
  {
    href: '/company/automations',
    title: 'Send messages automatically',
    body: 'Order confirmations, tracking links and basket reminders, without anybody typing them.',
  },
  {
    href: '/company/agents',
    title: 'Bring your team in',
    body: 'Invite whoever answers customers, so a chat the assistant cannot finish reaches a person.',
  },
];

export default async function CompanySetupPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const setup: CompanySetupProgress = await getCompanySetupProgress();
  const nextKey = setup.nextStep?.key;
  const allDone = setup.nextStep === null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* The company name is an eyebrow above the page title; `PageHeader` has no
          slot for one, so it stays a sibling rather than being folded into the h1. */}
      <div className="space-y-1">
        <p className="text-sm font-medium text-muted-foreground">{setup.companyName}</p>
        <PageHeader
          title="Get set up"
          description={
            allDone
              ? 'Everything on the list is done. Your assistant is answering customers — here is what you can add next.'
              : 'Five things to do, in this order. Each one is saved as you finish it, so you can stop and come back whenever you like.'
          }
        />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Your checklist</CardTitle>
          {/* A count, not a percentage. "3 of 5" is a position in a list you can
              see; "60% ready" is a mark out of a hundred nobody asked for. */}
          <p className="text-sm text-muted-foreground">
            {setup.complete} of {setup.total} done
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <ol className="divide-y border-t">
            {setup.steps.map((step, index) => (
              <ChecklistRow
                key={step.key}
                step={step}
                index={index}
                isNext={step.key === nextKey}
              />
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>The quick way to do step 3</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            If you already have a website, give us the address and we will read your pages for you — your services,
            your prices, your opening hours, your policies. Then you only have to fill in what is missing.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          <WebsiteOnboardingForm />
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-md border p-3 text-sm">
              <p className="font-medium">It takes a snapshot</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Good for services, common questions, policies, contact details and general descriptions — the things
                that rarely change.
              </p>
            </div>
            <div className="rounded-md border p-3 text-sm">
              <p className="font-medium">Prices and stock need a link</p>
              <p className="mt-1 text-xs text-muted-foreground">
                For anything that changes daily, connect Shopify, WooCommerce or a spreadsheet instead, so it stays
                right by itself.
              </p>
            </div>
            <div className="rounded-md border p-3 text-sm">
              <p className="font-medium">It will never guess</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Until your product list is connected, it tells customers to check the price or availability with you
                rather than making a number up.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Check it before customers see it</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Each job you turned on needs certain facts before it can do anything useful. Here is what is ready and
              what is still missing.
            </p>
          </div>
          <Badge
            variant={
              setup.customerReadiness.percent >= 80
                ? 'success'
                : setup.customerReadiness.percent >= 50
                  ? 'warning'
                  : 'secondary'
            }
          >
            {setup.customerReadiness.readyCount} of {setup.customerReadiness.enabledCount} ready
          </Badge>
        </CardHeader>
        <CardContent className="space-y-5">
          {setup.customerReadiness.missingCritical.length ? (
            <Alert tone="warning" title="Sort these out before you go live">
              <ul className="list-inside list-disc space-y-1">
                {setup.customerReadiness.missingCritical.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Alert>
          ) : (
            <Alert tone="success">
              Everything you have turned on has the facts it needs. Try the questions below before you put it on
              your website.
            </Alert>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            {setup.customerReadiness.capabilities.map((capability) => (
              <div key={capability.key} className="rounded-md border p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{capability.label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {capability.enabled ? 'Turned on for your website assistant' : 'Not turned on'}
                    </p>
                  </div>
                  <Badge
                    variant={capability.ready ? 'success' : capability.enabled ? 'warning' : 'secondary'}
                  >
                    {capability.ready ? 'Ready' : capability.enabled ? 'Needs facts' : 'Off'}
                  </Badge>
                </div>
                {capability.enabled && capability.missing.length ? (
                  <div className="mt-3 space-y-2">
                    <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
                      {capability.missing.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                    <Button asChild size="sm" variant="outline">
                      <Link href={capability.href}>Add these</Link>
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          {setup.customerReadiness.testScenarios.length ? (
            <div className="rounded-md border bg-muted/30 p-4">
              <p className="text-sm font-medium">Try asking it these</p>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {setup.customerReadiness.testScenarios.map((scenario) => (
                  <div key={scenario} className="rounded-md border bg-background p-3 text-sm">
                    {scenario}
                  </div>
                ))}
              </div>
              <Button asChild className="mt-4" variant="outline">
                <Link href="/company/widget">Set up the chat on my website</Link>
              </Button>
            </div>
          ) : (
            <div className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
              Create an assistant for your customers and pick what it can help with, and the questions to test it
              with will appear here.
            </div>
          )}

          {/* The suggested questions above are useless without somewhere to ask them. */}
          <div id="test-assistant" className="scroll-mt-6">
            <TestAssistant />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>When you are ready for more</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            None of this is required. Come back to it once the five above are done.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          {NEXT_MOVES.map((move) => (
            <Link
              key={move.href}
              href={move.href}
              className="rounded-md border p-3 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <p className="text-sm font-medium">{move.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{move.body}</p>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
