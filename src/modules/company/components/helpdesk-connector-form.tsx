'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  createHelpdeskConnectorAction,
  queueConnectorEventAction,
  type ConnectorActionState,
} from '../helpdesk-actions';
import type { ActionState } from '../actions';

const connectorInitial: ConnectorActionState = {};
const eventInitial: ActionState = {};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving...' : label}
    </Button>
  );
}

export function HelpdeskConnectorForm() {
  const [state, action] = useFormState(createHelpdeskConnectorAction, connectorInitial);

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="connector-name">Connector name</Label>
          <Input id="connector-name" name="name" placeholder="Main POS connector" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="connector-platform">Platform</Label>
          <select
            id="connector-platform"
            name="platform"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            defaultValue="dotnet"
          >
            <option value="dotnet">.NET / Windows POS</option>
            <option value="android">Android app</option>
            <option value="web">Website / web app</option>
          </select>
        </div>
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.token ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
          <p className="font-medium">Connector token for {state.connectorName}</p>
          <p className="mt-1">Copy it now. It is shown only once.</p>
          <pre className="mt-2 overflow-auto rounded bg-white p-2 text-xs">{state.token}</pre>
        </div>
      ) : null}
      <SubmitButton label="Create connector" />
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
      <textarea
        id={`request-${actionId}`}
        name="requestJson"
        rows={3}
        className="w-full rounded-md border bg-background p-2 font-mono text-xs"
        defaultValue={'{"query":"Pepsi"}'}
      />
      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
      {state.ok ? <p className="text-xs text-emerald-600">Queued. Connector can poll events now.</p> : null}
      <Button type="submit" size="sm" variant="outline">
        Queue test event
      </Button>
    </form>
  );
}
