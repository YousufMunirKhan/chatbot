'use client';

import { useFormState } from 'react-dom';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { RefreshDashboardShell } from '@/components/refresh-dashboard-shell';
import {
  createHelpdeskConnectorAction,
  queueConnectorEventAction,
  type ConnectorActionState,
} from '../helpdesk-actions';
import type { ActionState } from '../actions';

const connectorInitial: ConnectorActionState = {};
const eventInitial: ActionState = {};

export function HelpdeskConnectorForm() {
  const [state, action] = useFormState(createHelpdeskConnectorAction, connectorInitial);

  return (
    <form action={action} className="space-y-4">
      <RefreshDashboardShell state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Connector name" htmlFor="connector-name">
          <Input name="name" placeholder="Main POS connector" required />
        </FormField>
        <FormField
          label="Platform"
          htmlFor="connector-platform"
          hint="Node, Laravel, React, and Vue use the web connector token, but their downloads are separate."
        >
          <Select name="platform" defaultValue="dotnet">
            <option value="dotnet">.NET / Windows POS</option>
            <option value="android">Android app</option>
            <option value="web">Web backend</option>
            <option value="node">Node backend</option>
            <option value="laravel">Laravel backend</option>
            <option value="react">React admin UI</option>
            <option value="vue">Vue admin UI</option>
          </Select>
        </FormField>
      </div>
      <FormMessage state={{ error: state.error }} />
      {state.token ? (
        // Rich success payload, so `Alert` + a hand-added live region rather
        // than `FormMessage` (which is a single `<p>`). The `<pre>` was
        // `bg-white`, which is invisible in dark mode; `bg-background` is the
        // same white in light mode and follows the theme.
        <Alert tone="success" role="status" aria-live="polite" className="p-3">
          <p className="font-medium">Connector token for {state.connectorName}</p>
          <p className="mt-1">Copy it now. It is shown only once.</p>
          <pre className="mt-2 overflow-auto rounded bg-background p-2 text-xs">{state.token}</pre>
        </Alert>
      ) : null}
      <SubmitButton pendingLabel="Saving...">Create connector</SubmitButton>
    </form>
  );
}

export function QueueConnectorEventForm({ actionId }: { actionId: string }) {
  const [state, action] = useFormState(queueConnectorEventAction, eventInitial);

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="actionId" value={actionId} />
      <Label htmlFor={`request-${actionId}`} className="text-xs">
        Test request JSON
      </Label>
      {/* `min-h-0 p-2`: `Textarea` brings the shared border/background/ring, but
          its 80px floor and `px-3 py-2` would grow this 3-row mono box. */}
      <Textarea
        id={`request-${actionId}`}
        name="requestJson"
        rows={3}
        className="min-h-0 p-2 font-mono text-xs"
        defaultValue={'{"query":"Pepsi"}'}
      />
      <div className="grid gap-2 text-xs">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="dryRun" defaultChecked className="h-4 w-4" />
          Dry-run sandbox test
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="confirmed" className="h-4 w-4" />
          Confirm real write action
        </label>
      </div>
      <FormMessage
        state={state}
        okText="Queued. Connector can receive it by WebSocket or polling."
        className="text-xs"
      />
      <Button type="submit" size="sm" variant="outline">
        Queue sandbox event
      </Button>
    </form>
  );
}
