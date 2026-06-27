'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { updatePromptConfigAction, type ActionState } from '../actions';
import type { PromptConfig } from '@/lib/ai/prompts/assemble';

const initial: ActionState = {};
const selectCls =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function Save() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : 'Save & rebuild prompt'}
    </Button>
  );
}

export function PromptConfigForm({
  botId,
  botType,
  config,
}: {
  botId: string;
  botType: string;
  config: PromptConfig;
}) {
  const [state, action] = useFormState(updatePromptConfigAction, initial);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="botId" value={botId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="industry">Industry</Label>
          <Input id="industry" name="industry" defaultValue={config.industry ?? ''} placeholder="restaurant, clinic, retail…" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tone">Tone</Label>
          <select id="tone" name="tone" className={selectCls} defaultValue={config.tone ?? 'professional'}>
            <option value="professional">Professional</option>
            <option value="friendly">Friendly</option>
            <option value="concise">Concise</option>
            <option value="warm">Warm</option>
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="customInstructions">Additional instructions</Label>
        <Textarea
          id="customInstructions"
          name="customInstructions"
          defaultValue={config.customInstructions ?? ''}
          placeholder="e.g. Always mention free delivery over 200 AED. Office hours 9–6 Sun–Thu."
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="customPrompt">
          Custom base prompt {botType === 'custom' ? '(used — type is Custom)' : '(used only when type = Custom)'}
        </Label>
        <Textarea
          id="customPrompt"
          name="customPrompt"
          defaultValue={config.customPrompt ?? ''}
          placeholder="Override the base persona entirely…"
        />
      </div>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-emerald-600">Saved — system prompt rebuilt.</p> : null}
      <Save />
    </form>
  );
}
