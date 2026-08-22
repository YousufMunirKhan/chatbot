'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { CompanySetupProgress } from '../setup-data';

// Scoped per company — a bare key leaked the wizard position across account
// switches and super-admin impersonation.
const STORAGE_PREFIX = 'company-onboarding-active-step';

function storageKey(companyId: string) {
  return `${STORAGE_PREFIX}:${companyId}`;
}

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
      {complete ? (
        <>
          <Check className="h-4 w-4" aria-hidden="true" />
          {/* The icon replaced a literal "OK", which was the only thing telling a
              screen-reader user this step was finished. Keep that meaning. */}
          <span className="sr-only">Done</span>
        </>
      ) : (
        index + 1
      )}
    </span>
  );
}

export function OnboardingWizard({ setup }: { setup: CompanySetupProgress }) {
  const firstIncompleteKey = setup.nextStep?.key ?? setup.steps[0]?.key ?? '';
  const [activeKey, setActiveKey] = useState(firstIncompleteKey);

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey(setup.companyId));
    const savedStep = setup.steps.find((step) => step.key === saved);
    // Restore the remembered step only while it is still outstanding. Once the
    // server reports it complete, the freshly computed first-incomplete step
    // wins — otherwise a cached key pins the wizard to finished work.
    if (savedStep && !savedStep.complete) setActiveKey(savedStep.key);
  }, [setup.companyId, setup.steps]);

  useEffect(() => {
    if (activeKey) window.localStorage.setItem(storageKey(setup.companyId), activeKey);
  }, [activeKey, setup.companyId]);

  const activeIndex = Math.max(
    0,
    setup.steps.findIndex((step) => step.key === activeKey),
  );
  const activeStep = (setup.steps[activeIndex] ?? setup.steps[0])!;
  const nextStepKey = (setup.steps[Math.min(activeIndex + 1, setup.steps.length - 1)] ?? activeStep)
    .key;
  const previousStepKey = (setup.steps[Math.max(activeIndex - 1, 0)] ?? activeStep).key;

  /**
   * Step guidance for the shop owner.
   *
   * This used to be three columns headed "Focus", "Cost control" and "Done
   * when", carrying text written for the people building this product — product
   * directives, notes about AI tokens and deterministic prompt assembly. None of
   * that is the customer's business. What survives is the only part they needed:
   * what to do, and how they know the step is finished.
   */
  const guidance = useMemo(() => {
    if (!activeStep) return null;
    const copy: Record<string, { todo: string; done: string }> = {
      purpose: {
        todo: 'Choose who the assistant talks to: your website visitors, or your own staff. You can create one of each.',
        done: 'You have saved an assistant.',
      },
      capabilities: {
        todo: 'Pick only what you want it to help with today. You can turn more on whenever you are ready.',
        done: 'The assistant does at least one thing.',
      },
      'required-data': {
        todo: 'Start by importing your website, then fill in whatever is still missing: services, opening hours, policies, and common questions.',
        done: 'Your business details and answers are saved.',
      },
      test: {
        todo: 'Ask it the questions your customers actually ask, including a few it will not know the answer to.',
        done: 'It has enough to answer from.',
      },
      install: {
        todo: 'Add your website address, copy the snippet, and paste it into your site.',
        done: 'At least one website address is added.',
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
            <div className="border-b bg-muted/30 p-5 lg:border-b-0 lg:border-e">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Saved progress
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    We remember where you left off, and tick steps off as you finish them.
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
                        'flex w-full gap-3 rounded-md border p-3 text-start transition-colors',
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
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-md border p-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      What to do
                    </p>
                    <p className="mt-2 text-sm">{guidance.todo}</p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      You are done when
                    </p>
                    <p className="mt-2 text-sm">{guidance.done}</p>
                  </div>
                </div>
              ) : null}

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
    </div>
  );
}
