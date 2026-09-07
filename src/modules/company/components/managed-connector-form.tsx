'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormState } from 'react-dom';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { RefreshDashboardShell } from '@/components/refresh-dashboard-shell';
import { createManagedConnectorAction, type ActionState } from '../managed-connectors-actions';

const initial: ActionState = {};

type Field = { key: string; label: string; required: boolean };

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
      <RefreshDashboardShell state={state} />
      <FormField label="Platform" htmlFor="platform">
        {/* Second of the two inline-styled selects: `Select` upgrades its bare
            `border` to `border-input` and adds the standard focus ring. */}
        <Select
          name="platform"
          value={platform as string}
          onChange={(e) => setPlatform(e.target.value)}
        >
          <option value="shopify">Shopify</option>
          <option value="square">Square</option>
          <option value="foodics">Foodics</option>
        </Select>
      </FormField>

      {activeFields.map((f) => (
        <FormField key={f.key} label={f.label} htmlFor={f.key}>
          <Input
            name={f.key}
            type={f.key === 'token' ? 'password' : 'text'}
            autoComplete="off"
            required={f.required}
          />
        </FormField>
      ))}

      <p className="text-xs text-muted-foreground">
        Credentials are encrypted at rest. We run the platform&apos;s read actions server-side — no
        SDK to install.
      </p>
      <FormMessage state={state} okText="Connected. The assistant can now use it." />
      <SubmitButton pendingLabel="Connecting…">Connect &amp; activate</SubmitButton>
    </form>
  );
}
