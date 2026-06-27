'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { CompanySetupProgress } from '../setup-data';

const STORAGE_KEY = 'company-onboarding-active-step';

function StepDot({
  complete,
  active,
  index,
}: {
  complete: boolean;
  active: boolean;
  index: number;
}) {
  return (
    <span
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
        complete
          ? 'bg-emerald-100 text-emerald-700'
          : active
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground',
      )}
    >
      {complete ? 'OK' : index + 1}
    </span>
  );
}

export function OnboardingWizard({ setup }: { setup: CompanySetupProgress }) {
  const firstIncompleteKey = setup.nextStep?.key ?? setup.steps[0]?.key ?? '';
  const [activeKey, setActiveKey] = useState(firstIncompleteKey);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved && setup.steps.some((step) => step.key === saved)) {
      setActiveKey(saved);
    }
  }, [setup.steps]);

  useEffect(() => {
    if (activeKey) window.localStorage.setItem(STORAGE_KEY, activeKey);
  }, [activeKey]);

  const activeIndex = Math.max(
    0,
    setup.steps.findIndex((step) => step.key === activeKey),
  );
  const activeStep = (setup.steps[activeIndex] ?? setup.steps[0])!;
  const nextStepKey = (setup.steps[Math.min(activeIndex + 1, setup.steps.length - 1)] ?? activeStep)
    .key;
  const previousStepKey = (setup.steps[Math.max(activeIndex - 1, 0)] ?? activeStep).key;

  const guidance = useMemo(() => {
    if (!activeStep) return null;
    const copy: Record<string, { focus: string; cost: string; check: string }> = {
      purpose: {
        focus:
          'Start with audience: customer-facing website assistant or internal help desk. Do not force users into fixed agent templates.',
        cost: 'No AI call needed. This is only product configuration.',
        check: 'A saved assistant exists.',
      },
      capabilities: {
        focus:
          'Pick only what the assistant should do now. Capabilities decide required data and prompt behavior.',
        cost: 'No AI call needed. The prompt is assembled deterministically.',
        check: 'Assistant has at least one capability.',
      },
      'required-data': {
        focus:
          'Start from the website URL, then ask only for missing services, hours, policies, FAQs, lead rules, or catalogue data.',
        cost: 'Website import and forms run before chat AI. For live prices/stock, use integrations, CSV refresh, Custom API, or a connector instead of re-crawling pages.',
        check: 'Business profile, structured facts, or knowledge documents are present.',
      },
      test: {
        focus: 'Test common customer questions and missing-data questions before installing.',
        cost: 'Testing uses real chat calls, so keep it focused and cache safe repeated questions.',
        check: 'Assistant has enough data to test.',
      },
      install: {
        focus:
          'Add website domain, copy the snippet, and launch. Keep internal help desk assistants out of public widgets.',
        cost: 'Widget load does not call AI until a visitor sends a message.',
        check: 'At least one allowed website domain is configured.',
      },
    };
    return copy[activeStep.key] ?? null;
  }, [activeStep]);

  if (!activeStep) return null;

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="grid gap-0 lg:grid-cols-[0.85fr_1.15fr]">
            <div className="border-b bg-muted/30 p-5 lg:border-b-0 lg:border-r">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Saved progress
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Resume is based on real setup data plus your last opened step.
                  </p>
                </div>
                <Badge
                  variant={
                    setup.percent >= 80 ? 'success' : setup.percent >= 50 ? 'warning' : 'secondary'
                  }
                >
                  {setup.percent}%
                </Badge>
              </div>

              <div className="space-y-2">
                {setup.steps.map((step, index) => {
                  const active = step.key === activeStep.key;
                  return (
                    <button
                      key={step.key}
                      type="button"
                      onClick={() => setActiveKey(step.key)}
                      className={cn(
                        'flex w-full gap-3 rounded-md border p-3 text-left transition-colors',
                        active
                          ? 'border-primary bg-background shadow-sm'
                          : 'bg-background/70 hover:bg-background',
                      )}
                    >
                      <StepDot complete={step.complete} active={active} index={index} />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{step.title}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {step.detail}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-5 p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <Badge variant={activeStep.complete ? 'success' : 'secondary'}>
                    {activeStep.complete ? 'Complete' : 'Needs action'}
                  </Badge>
                  <h2 className="mt-3 text-2xl font-semibold tracking-tight">{activeStep.title}</h2>
                  <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                    {activeStep.description}
                  </p>
                </div>
                <Button asChild>
                  <Link href={activeStep.href}>
                    {activeStep.complete ? 'Review this step' : `Open ${activeStep.title}`}
                  </Link>
                </Button>
              </div>

              {guidance ? (
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-md border p-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Focus
                    </p>
                    <p className="mt-2 text-sm">{guidance.focus}</p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Cost control
                    </p>
                    <p className="mt-2 text-sm">{guidance.cost}</p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Done when
                    </p>
                    <p className="mt-2 text-sm">{guidance.check}</p>
                  </div>
                </div>
              ) : null}

              <div className="rounded-md border bg-muted/30 p-4">
                <p className="text-sm font-medium">Enterprise rule for this step</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Collect the smallest useful data set, keep internal and customer channels
                  separate, and make every risky action explicit, confirmed, and audit logged.
                </p>
              </div>

              <div className="flex flex-wrap justify-between gap-3 border-t pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setActiveKey(previousStepKey)}
                  disabled={activeIndex === 0}
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setActiveKey(nextStepKey)}
                  disabled={activeIndex === setup.steps.length - 1}
                >
                  Next step
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No setup AI waste</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Forms, parsing, validation, and deterministic prompt assembly happen before any chat
            model call.
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Data decides behavior</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Selected capabilities decide which data is required, which tools are enabled, and what
            the assistant is allowed to answer.
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Safe launch path</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Internal help desk stays private. Website assistants require domain control and can hand
            over to humans.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
