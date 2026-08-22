import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Progress } from '@/components/ui/progress';
import { getCompanySetupProgress } from '@/modules/company/setup-data';
import { OnboardingWizard } from '@/modules/company/components/onboarding-wizard';
import { TestAssistant } from '@/modules/company/components/test-assistant';
import { WebsiteOnboardingForm } from '@/modules/company/components/website-onboarding-form';

export default async function CompanySetupPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const setup = await getCompanySetupProgress();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* The company name is an eyebrow above the page title; `PageHeader` has no
          slot for one, so it stays a sibling rather than being folded into the h1. */}
      <div className="space-y-1">
        <p className="text-sm font-medium text-muted-foreground">{setup.companyName}</p>
        <PageHeader
          title="Setup journey"
          description="Finish the essentials in order, or jump to the part you need. Your progress is saved from real business data."
          actions={
            <>
              <Badge variant={setup.percent >= 80 ? 'success' : setup.percent >= 50 ? 'warning' : 'secondary'}>
                {setup.percent}% ready
              </Badge>
              {setup.nextStep ? (
                <Button asChild>
                  <Link href={setup.nextStep.href}>Continue: {setup.nextStep.title}</Link>
                </Button>
              ) : (
                <Button asChild>
                  <Link href="/company/widget">Test widget</Link>
                </Button>
              )}
            </>
          }
        />
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="grid gap-0 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-4 p-6">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Ready to answer</span>
                <span className="text-muted-foreground">
                  {setup.complete} of {setup.total} complete
                </span>
              </div>
              <Progress value={setup.percent} label="Ready to answer" />
              <p className="text-sm text-muted-foreground">
                {setup.nextStep
                  ? `Next best action: ${setup.nextStep.description}`
                  : 'Everything important is ready. Keep improving answers from the Business Data workspace.'}
              </p>
            </div>
            {/* Module 21 (RTL): logical seams, so the divider stays inside the block
                when the grid reverses. */}
            <div className="grid grid-cols-2 border-t bg-muted/30 lg:border-s lg:border-t-0">
              <div className="border-b border-e p-4">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Assistants</p>
                <p className="mt-1 text-2xl font-semibold">{setup.stats.bots}</p>
              </div>
              <div className="border-b p-4">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Knowledge docs</p>
                <p className="mt-1 text-2xl font-semibold">{setup.stats.knowledgeDocs}</p>
              </div>
              <div className="border-e p-4">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Team members</p>
                <p className="mt-1 text-2xl font-semibold">{setup.stats.teamMembers}</p>
              </div>
              <div className="p-4">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Your business details</p>
                <p className="mt-1 text-2xl font-semibold">{setup.stats.businessReadiness}%</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Start from your website</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Import the pages you already have, then fill in whatever is still missing.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          <WebsiteOnboardingForm />
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-md border p-3 text-sm">
              <p className="font-medium">Website import is static</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Good for services, FAQs, policies, contact details, and general product descriptions.
              </p>
            </div>
            <div className="rounded-md border p-3 text-sm">
              <p className="font-medium">Live prices need a source</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Use Shopify, WooCommerce, CSV refresh, Custom API, or a connector for changing prices and stock.
              </p>
            </div>
            <div className="rounded-md border p-3 text-sm">
              <p className="font-medium">It will never guess at stock</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Until your product list is linked up, it tells customers to check the price or availability with you.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Before you go live</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Here is what your website assistant can help with, and what it still needs from you.
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
            <Alert tone="warning" title="Fix these before you go live">
              <ul className="list-inside list-disc space-y-1">
                {setup.customerReadiness.missingCritical.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Alert>
          ) : (
            <Alert tone="success">
              Everything you have turned on has the details it needs. Try the questions below before you install it.
            </Alert>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            {setup.customerReadiness.capabilities.map((capability) => (
              <div key={capability.key} className="rounded-md border p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{capability.label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {capability.enabled ? 'Turned on for your website assistant' : 'Not turned on yet'}
                    </p>
                  </div>
                  <Badge
                    variant={
                      capability.ready ? 'success' : capability.enabled ? 'warning' : 'secondary'
                    }
                  >
                    {capability.ready ? 'Ready' : capability.enabled ? 'Missing data' : 'Off'}
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
                      <Link href={capability.href}>Add data</Link>
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          {setup.customerReadiness.testScenarios.length ? (
            <div className="rounded-md border bg-muted/30 p-4">
              <p className="text-sm font-medium">Run these tests before launch</p>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {setup.customerReadiness.testScenarios.map((scenario) => (
                  <div key={scenario} className="rounded-md border bg-background p-3 text-sm">
                    {scenario}
                  </div>
                ))}
              </div>
              <Button asChild className="mt-4" variant="outline">
                <Link href="/company/widget">Design and install the widget</Link>
              </Button>
            </div>
          ) : (
            <div className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
              Create a website assistant and choose what it can help with, and test questions appear here.
            </div>
          )}

          {/* The launch tests above are useless without somewhere to run them. */}
          <div id="test-assistant" className="scroll-mt-6">
            <TestAssistant />
          </div>
        </CardContent>
      </Card>

      <OnboardingWizard setup={setup} />
    </div>
  );
}
