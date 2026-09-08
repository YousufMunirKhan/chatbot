'use client';

import Link from 'next/link';
import { useFormState } from 'react-dom';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { FIELD_GRID } from './form-layout';
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
      {/*
        Industry and Tone are each set in TWO places and both copies reach the
        same reply.

        Industry: this one is baked into the stored system prompt
        (src/lib/ai/prompts/assemble.ts:45), while My business info writes
        `company_business_profiles.industry`, which is injected fresh into the
        business facts on every turn (src/lib/ai/business-context.ts:106). Put
        "clinic" in one and "retail" in the other and the model is handed both.

        Tone: this one colours the persona line (assemble.ts:41); My business
        info's brand voice, answer length and sales style are listed in the
        business facts under an explicit instruction to follow them
        (src/lib/ai/engine.ts:406), so those win a disagreement.

        Neither can be deleted from here without touching the prompt assembly,
        which this pass does not own. Both hints now name the other screen and
        say which one wins, so nobody sets them against each other by accident.
      */}
      <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">These two are also set in My business info</p>
        <p className="mt-1">
          What you put here is folded into the assistant&apos;s standing instructions. The trade,
          brand voice and answer style on{' '}
          <Link href="/company/business-data" className="underline">
            My business info
          </Link>{' '}
          are read again on every single reply, so if the two disagree, that page is the one the
          assistant is told to follow. Set them there first and leave these two alone unless this
          one assistant needs to differ.
        </p>
      </div>

      <div className={FIELD_GRID}>
        <FormField
          label="Trade or industry"
          htmlFor="industry"
          hint="One or two words for what your business does. Leave it empty to use the industry from My business info."
        >
          <Input
            name="industry"
            defaultValue={config.industry ?? ''}
            placeholder="restaurant, clinic, retail…"
          />
        </FormField>
        <FormField
          label="How it should sound"
          htmlFor="tone"
          hint="The overall register of every reply. The brand voice on My business info is more specific and overrides this where they clash."
        >
          <Select name="tone" defaultValue={config.tone ?? 'professional'}>
            <option value="professional">Professional</option>
            <option value="friendly">Friendly</option>
            <option value="concise">Concise</option>
            <option value="warm">Warm</option>
          </Select>
        </FormField>
      </div>

      <FormField
        label="Anything else it should always do"
        htmlFor="customInstructions"
        hint="Added to every reply's instructions, on top of everything else. Standing rules, not facts — facts belong in My business info."
      >
        <Textarea
          name="customInstructions"
          defaultValue={config.customInstructions ?? ''}
          placeholder="e.g. Always mention free delivery over 200 AED. Office hours 9–6 Sun–Thu."
        />
      </FormField>

      {/*
        This box replaces the assistant's whole personality, and it is read
        only when the assistant's Type is Custom (assemble.ts). The label used
        to admit that in a parenthesis — "(used only when type = Custom)" —
        which meant every other assistant got a large textarea that changed
        nothing, labelled in a syntax nobody outside the team writes.

        It is now shown only when it applies. Anything already typed is carried
        in a hidden input, because `updatePromptConfigAction` rebuilds the whole
        `prompt_config` blob from the form and a missing field is stored as
        null (src/modules/company/actions.ts:346) — dropping the input would
        erase a prompt somebody had written.
      */}
      {botType === 'custom' ? (
        <FormField
          label="Replace the assistant's personality entirely"
          htmlFor="customPrompt"
          required={false}
          hint="Only this assistant's Type is set to Custom, so this is the text it starts from. Everything the built-in personalities do — the greeting, the refusal to invent answers, the handover rules — has to be written here yourself. Leave it empty to fall back to the standard personality."
        >
          <Textarea
            name="customPrompt"
            rows={6}
            defaultValue={config.customPrompt ?? ''}
            placeholder="You are the assistant for…"
          />
        </FormField>
      ) : (
        <>
          <input type="hidden" name="customPrompt" value={config.customPrompt ?? ''} />
          <p className="text-xs text-muted-foreground">
            This assistant uses one of the built-in personalities, so there is nothing to write
            here. Change its Type to Custom above if you want to write the whole personality
            yourself.
            {config.customPrompt
              ? ' A custom personality you wrote earlier is saved and will come back if you do.'
              : ''}
          </p>
        </>
      )}

      <FormMessage state={state} okText="Saved. Your assistant uses this from its next reply." />
      <SubmitButton>Save these instructions</SubmitButton>
    </form>
  );
}
