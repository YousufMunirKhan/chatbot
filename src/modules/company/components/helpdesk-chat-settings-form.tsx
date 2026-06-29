'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { HelpdeskChatSettings } from '@/lib/helpdesk/chat-settings';
import { saveHelpdeskChatSettingsAction } from '../helpdesk-chat-settings-actions';
import type { ActionState } from '../actions';

const initial: ActionState = {};
const selectCls =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function SubmitButton() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? 'Saving...' : 'Save chat rules'}</Button>;
}

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
        <div className="space-y-1.5">
          <Label>Show mode</Label>
          <select name="showMode" defaultValue={settings.showMode} className={selectCls}>
            <option value="floating">Floating bubble</option>
            <option value="embedded">Embedded panel</option>
            <option value="hidden">Hidden</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Position</Label>
          <select name="position" defaultValue={settings.position} className={selectCls}>
            <option value="right">Right</option>
            <option value="left">Left</option>
          </select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Allowed app roles</Label>
        <Input name="allowedRoles" defaultValue={settings.allowedRoles.join(', ')} placeholder="admin, manager, staff" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Allowed routes/screens</Label>
          <Textarea name="allowedRoutes" rows={5} defaultValue={settings.allowedRoutes.join('\n')} />
          <p className="text-xs text-muted-foreground">Supports wildcards like inventory/* and reports/*.</p>
        </div>
        <div className="space-y-1.5">
          <Label>Blocked routes/screens</Label>
          <Textarea name="blockedRoutes" rows={5} defaultValue={settings.blockedRoutes.join('\n')} />
          <p className="text-xs text-muted-foreground">Blocked routes always win over allowed routes.</p>
        </div>
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-emerald-600">Saved.</p> : null}
      <SubmitButton />
    </form>
  );
}
