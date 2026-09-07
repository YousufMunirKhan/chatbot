'use client';

import { useFormState } from 'react-dom';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import type { HelpdeskChatSettings } from '@/lib/helpdesk/chat-settings';
import { saveHelpdeskChatSettingsAction } from '../helpdesk-chat-settings-actions';
import type { ActionState } from '../actions';

const initial: ActionState = {};

export function HelpdeskChatSettingsForm({ settings }: { settings: HelpdeskChatSettings }) {
  const [state, action] = useFormState(saveHelpdeskChatSettingsAction, initial);
  return (
    <form action={action} className="space-y-4">
      {/*
        Three of the five controls that used to be here changed nothing.
        `canShowHelpdeskChat` (src/lib/helpdesk/chat-settings.ts:62-72) is the
        only thing that ever consults these settings, and it reads exactly
        `enabled`, `showMode === 'hidden'`, `blockedRoutes` and `allowedRoutes`.

          - "Auto-open when allowed" (`auto_open`) — never read anywhere.
          - "Position" Right/Left (`position`) — never read anywhere. It is not
            the widget's `position`, which is a different column and is used.
          - "Show mode" — only `hidden` is ever branched on, so "Floating
            bubble" and "Embedded panel" produced identical behaviour. The
            picker is now the one real choice, folded into the on/off switch
            it duplicated: showing the desk and setting the mode to anything
            other than hidden were two ways of saying the same thing.

        The dead values are carried in hidden inputs so re-saving does not
        rewrite rows, and so the columns are ready if the serving side ever
        starts reading them.
      */}
      <input type="hidden" name="autoOpen" value={settings.autoOpen ? 'on' : ''} />
      <input type="hidden" name="position" value={settings.position} />
      <input
        type="hidden"
        name="showMode"
        value={settings.showMode === 'hidden' ? 'hidden' : settings.showMode}
      />
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={settings.enabled}
          className="mt-0.5 h-4 w-4"
        />
        <span>
          Show the staff help desk inside your own software
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            Untick this and the chat disappears from every screen for everyone, whatever the two
            route lists below say.
          </span>
        </span>
      </label>
      <div className="grid gap-4 md:grid-cols-2">
        <FormField
          label="Only show it on these screens"
          htmlFor="allowedRoutes"
          hint="One screen address per line, e.g. /till or /orders/*. Leave this empty — as most shops do — and it shows everywhere except the list beside it."
        >
          <Textarea
            name="allowedRoutes"
            rows={5}
            defaultValue={settings.allowedRoutes.join('\n')}
          />
        </FormField>
        <FormField
          label="Never show it on these screens"
          htmlFor="blockedRoutes"
          hint="One per line. This wins over the list beside it. Use it for the sign-in screen, the payment screen, and anything a customer can see."
        >
          <Textarea
            name="blockedRoutes"
            rows={5}
            defaultValue={settings.blockedRoutes.join('\n')}
          />
        </FormField>
      </div>
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Saving...">Save chat rules</SubmitButton>
    </form>
  );
}
