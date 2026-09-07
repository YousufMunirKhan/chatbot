'use client';

import { useEffect, useRef } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import { createFlowAction, type CreateFlowState } from '../flows-actions';
import { FLOW_TEMPLATES } from '../flow-graph';

const initial: CreateFlowState = {};

/**
 * Creating a flow always ends in the builder — a new flow with nowhere to go is
 * the single most common way a builder feels broken. Both forms below share one
 * server action and both redirect on success.
 */
function useCreateFlow() {
  const [state, action] = useFormState(createFlowAction, initial);
  const router = useRouter();
  useEffect(() => {
    if (state.ok && state.flowId) router.push(`/company/flows/${state.flowId}`);
  }, [state.ok, state.flowId, router]);
  return { state, action };
}

export function NewFlowForm() {
  const { state, action } = useCreateFlow();
  const ref = useRef<HTMLFormElement>(null);

  return (
    <form ref={ref} action={action} className="space-y-4">
      <FormField
        label="Flow name"
        htmlFor="flow-name"
        required
        hint="Something you will recognise in a list six months from now."
      >
        <Input
          id="flow-name"
          name="name"
          placeholder="e.g. Weekend booking assistant"
          maxLength={120}
          required
        />
      </FormField>
      <input type="hidden" name="templateKey" value="blank" />
      <FormMessage state={{ error: state.error }} />
      <SubmitButton pendingLabel="Creating…">Create a blank flow</SubmitButton>
    </form>
  );
}

/**
 * `useFormStatus` is scoped to its own `<form>`, so each card spins alone.
 *
 * `w-full` is load-bearing, not decoration. "Use this template" needs about
 * 140px; an auto-width button in a column narrower than that overflows the card
 * and the label is clipped mid-word — which is exactly what happened when this
 * grid was rendered three-across inside a sidebar. Full width makes the button
 * shrink with its card instead of spilling out of it, whatever the layout does.
 */
function TemplateButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="outline" disabled={pending} className="w-full">
      {pending ? 'Building…' : 'Use this template'}
    </Button>
  );
}

/**
 * The five starter flows.
 *
 * Sized for a full-width container: two across on a tablet, three on a desktop,
 * which leaves roughly 360px per card at this page's `max-w-6xl`. Do not nest
 * this inside a narrow column — the descriptions are full sentences and need
 * the room to read as sentences.
 */
export function FlowTemplateGrid() {
  const { state, action } = useCreateFlow();
  const templates = FLOW_TEMPLATES.filter((t) => t.key !== 'blank');

  return (
    <div className="space-y-3">
      <FormMessage state={{ error: state.error }} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((template) => (
          <Card key={template.key} className="flex flex-col">
            <CardContent className="flex flex-1 flex-col gap-3 p-4">
              <div className="space-y-1.5">
                <h3 className="text-sm font-semibold leading-snug">{template.name}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {template.description}
                </p>
              </div>
              <form action={action} className="mt-auto pt-1">
                <input type="hidden" name="name" value={template.name} />
                <input type="hidden" name="description" value={template.description} />
                <input type="hidden" name="templateKey" value={template.key} />
                <TemplateButton />
              </form>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
