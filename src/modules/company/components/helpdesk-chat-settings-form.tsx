'use client';

import { useFormState } from 'react-dom';
import { Select } from '@/components/ui/select';
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
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="enabled" defaultChecked={settings.enabled} className="h-4 w-4" />
          Enabled
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="autoOpen" defaultChecked={settings.autoOpen} className="h-4 w-4" />
          Auto-open when allowed
        </label>
        <FormField label="Show mode" htmlFor="showMode">
          <Select name="showMode" defaultValue={settings.showMode}>
            <option value="floating">Floating bubble</option>
            <option value="embedded">Embedded panel</option>
            <option value="hidden">Hidden</option>
          </Select>
        </FormField>
        <FormField label="Position" htmlFor="position">
          <Select name="position" defaultValue={settings.position}>
            <option value="right">Right</option>
            <option value="left">Left</option>
          </Select>
        </FormField>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <FormField
          label="Only these routes/screens"
          htmlFor="allowedRoutes"
          hint="Optional. Leave empty to show Help Desk on every staff route except blocked routes."
        >
          <Textarea name="allowedRoutes" rows={5} defaultValue={settings.allowedRoutes.join('\n')} />
        </FormField>
        <FormField
          label="Blocked routes/screens"
          htmlFor="blockedRoutes"
          hint="Use this for screens where Help Desk should never appear, like login, payment, or customer display."
        >
          <Textarea name="blockedRoutes" rows={5} defaultValue={settings.blockedRoutes.join('\n')} />
        </FormField>
      </div>
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Saving...">Save chat rules</SubmitButton>
    </form>
  );
}
