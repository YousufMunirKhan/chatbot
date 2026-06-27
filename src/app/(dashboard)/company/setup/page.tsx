import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getCompanySetupProgress } from '@/modules/company/setup-data';
import { OnboardingWizard } from '@/modules/company/components/onboarding-wizard';
import { WebsiteOnboardingForm } from '@/modules/company/components/website-onboarding-form';

export default async function CompanySetupPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const setup = await getCompanySetupProgress();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{setup.companyName}</p>
          <h1 className="text-2xl font-semibold">Setup journey</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Finish the essentials in order, or jump to the part you need. Your progress is saved from real business data.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
        </div>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="grid gap-0 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-4 p-6">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Launch readiness</span>
                <span className="text-muted-foreground">
                  {setup.complete} of {setup.total} complete
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${setup.percent}%` }} />
              </div>
              <p className="text-sm text-muted-foreground">
                {setup.nextStep
                  ? `Next best action: ${setup.nextStep.description}`
                  : 'Everything important is ready. Keep improving answers from the Business Data workspace.'}
              </p>
            </div>
            <div className="grid grid-cols-2 border-t bg-muted/30 lg:border-l lg:border-t-0">
              <div className="border-b border-r p-4">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Assistants</p>
                <p className="mt-1 text-2xl font-semibold">{setup.stats.bots}</p>
              </div>
              <div className="border-b p-4">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Knowledge docs</p>
                <p className="mt-1 text-2xl font-semibold">{setup.stats.knowledgeDocs}</p>
              </div>
              <div className="border-r p-4">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Team members</p>
                <p className="mt-1 text-2xl font-semibold">{setup.stats.teamMembers}</p>
              </div>
              <div className="p-4">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Business data</p>
                <p className="mt-1 text-2xl font-semibold">{setup.stats.businessReadiness}%</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Website-first onboarding</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Start a website client by importing their public pages, then ask only for the missing launch details.
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
              <p className="font-medium">Bot should not guess stock</p>
              <p className="mt-1 text-xs text-muted-foreground">
                If no live catalogue is connected, the assistant should say stock or price needs confirmation.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Customer bot launch checklist</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Capability checks run from saved data only, so this does not spend AI tokens.
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
            <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
              <p className="font-medium">Fix before customer launch</p>
              <ul className="mt-2 list-inside list-disc space-y-1">
                {setup.customerReadiness.missingCritical.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
              Customer bot capabilities have the required launch data. Run the tests below before installing.
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            {setup.customerReadiness.capabilities.map((capability) => (
              <div key={capability.key} className="rounded-md border p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{capability.label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {capability.enabled ? 'Enabled for a customer assistant' : 'Not selected yet'}
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
              <p className="text-sm font-medium">Preview tests before launch</p>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {setup.customerReadiness.testScenarios.map((scenario) => (
                  <div key={scenario} className="rounded-md border bg-background p-3 text-sm">
                    {scenario}
                  </div>
                ))}
              </div>
              <Button asChild className="mt-4">
                <Link href="/company/widget">Open widget preview</Link>
              </Button>
            </div>
          ) : (
            <div className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
              Create a customer-facing assistant and choose capabilities to generate launch tests.
            </div>
          )}
        </CardContent>
      </Card>

      <OnboardingWizard setup={setup} />
    </div>
  );
}
