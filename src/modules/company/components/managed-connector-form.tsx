'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createManagedConnectorAction, type ActionState } from '../managed-connectors-actions';

const initial: ActionState = {};

type Field = { key: string; label: string; required: boolean };

function Save() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Connecting…' : 'Connect & activate'}
    </Button>
  );
}

export function ManagedConnectorForm({ fields }: { fields: Record<string, Field[]> }) {
  const [state, action] = useFormState(createManagedConnectorAction, initial);
  const [platform, setPlatform] = useState<keyof typeof fields>('shopify');
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);
  const activeFields = fields[platform] ?? [];

  return (
    <form ref={ref} action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="platform">Platform</Label>
        <select
          id="platform"
          name="platform"
          value={platform as string}
          onChange={(e) => setPlatform(e.target.value)}
          className="h-10 w-full rounded-md border bg-background px-3 text-sm"
        >
          <option value="shopify">Shopify</option>
          <option value="square">Square</option>
          <option value="foodics">Foodics</option>
        </select>
      </div>

      {activeFields.map((f) => (
        <div key={f.key} className="space-y-1.5">
          <Label htmlFor={f.key}>{f.label}</Label>
          <Input
            id={f.key}
            name={f.key}
            type={f.key === 'token' ? 'password' : 'text'}
            autoComplete="off"
            required={f.required}
          />
        </div>
      ))}

      <p className="text-xs text-muted-foreground">
        Credentials are encrypted at rest. We run the platform&apos;s read actions server-side — no SDK to install.
      </p>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-green-600">Connected. The assistant can now use it.</p> : null}
      <Save />
    </form>
  );
}
