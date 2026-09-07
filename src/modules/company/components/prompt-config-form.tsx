'use client';

import { useFormState } from 'react-dom';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { updatePromptConfigAction, type ActionState } from '../actions';
import type { PromptConfig } from '@/lib/ai/prompts/assemble';

const initial: ActionState = {};

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
        <FormField label="Industry" htmlFor="industry">
          <Input
            name="industry"
            defaultValue={config.industry ?? ''}
            placeholder="restaurant, clinic, retail…"
          />
        </FormField>
        <FormField label="Tone" htmlFor="tone">
          <Select name="tone" defaultValue={config.tone ?? 'professional'}>
            <option value="professional">Professional</option>
            <option value="friendly">Friendly</option>
            <option value="concise">Concise</option>
            <option value="warm">Warm</option>
          </Select>
        </FormField>
      </div>

      <FormField label="Additional instructions" htmlFor="customInstructions">
        <Textarea
          name="customInstructions"
          defaultValue={config.customInstructions ?? ''}
          placeholder="e.g. Always mention free delivery over 200 AED. Office hours 9–6 Sun–Thu."
        />
      </FormField>

      <FormField
        label={`Custom base prompt ${botType === 'custom' ? '(used — type is Custom)' : '(used only when type = Custom)'}`}
        htmlFor="customPrompt"
      >
        <Textarea
          name="customPrompt"
          defaultValue={config.customPrompt ?? ''}
          placeholder="Override the base persona entirely…"
        />
      </FormField>

      <FormMessage state={state} okText="Saved — system prompt rebuilt." />
      <SubmitButton>Save &amp; rebuild prompt</SubmitButton>
    </form>
  );
}
