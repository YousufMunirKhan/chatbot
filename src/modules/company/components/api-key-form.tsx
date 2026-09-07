'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormState } from 'react-dom';
import { Alert } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { CopyButton } from '@/components/copy-button';
import { createApiKeyAction, type CreateKeyState } from '../developers-actions';

const initial: CreateKeyState = {};

export interface ScopeOption {
  value: string;
  label: string;
}

/**
 * Create an API key.
 *
 * The plaintext key comes back in the action result and is rendered once, right
 * here, with a copy button — it is never stored, so there is no second chance
 * and the UI has to say so plainly.
 */
export function ApiKeyForm({ scopes }: { scopes: ScopeOption[] }) {
  const [state, action] = useFormState(createApiKeyAction, initial);
  const [fullAccess, setFullAccess] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      setFullAccess(false);
    }
  }, [state.ok]);

  return (
    <div className="space-y-4">
      {state.key ? (
        <Alert tone="warning" title="Copy your key now — it is shown only once">
          <p className="mb-2">
            This is the only time we can show the full key for{' '}
            <span className="font-medium">{state.keyName}</span>. Store it in your secret manager;
            if you lose it, revoke the key and create another.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded bg-background px-2 py-1 font-mono text-xs">
              {state.key}
            </code>
            <CopyButton value={state.key} label="Copy key" />
          </div>
        </Alert>
      ) : null}

      <form ref={formRef} action={action} className="space-y-4">
        <FormField
          label="Key name"
          htmlFor="name"
          hint="Where will this key be used? e.g. “Zapier”, “Internal CRM sync”."
        >
          <Input id="name" name="name" required maxLength={80} placeholder="Internal CRM sync" />
        </FormField>

        <FormField
          label="Expires"
          htmlFor="expiresInDays"
          hint="A short-lived key limits the damage if it leaks."
        >
          <Select id="expiresInDays" name="expiresInDays" defaultValue="never">
            <option value="never">Never</option>
            <option value="30">In 30 days</option>
            <option value="90">In 90 days</option>
            <option value="365">In 1 year</option>
          </Select>
        </FormField>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Scopes</legend>
          <p className="text-xs text-muted-foreground">
            Grant only what the integration needs. A request without the matching scope is refused
            with 403.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="fullAccess"
              className="size-4 rounded border-input"
              checked={fullAccess}
              onChange={(event) => setFullAccess(event.target.checked)}
            />
            <span className="font-medium">Full access (all scopes, including future ones)</span>
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            {scopes.map((scope) => (
              <label
                key={scope.value}
                className={`flex items-start gap-2 text-sm ${fullAccess ? 'opacity-50' : ''}`}
              >
                <input
                  type="checkbox"
                  name="scopes"
                  value={scope.value}
                  disabled={fullAccess}
                  className="mt-0.5 size-4 rounded border-input"
                />
                {/* The human sentence leads and the raw token is the second
                    line. Whoever ticks these boxes is the account owner, not the
                    developer consuming the key — but the token still has to be
                    on screen, because it is what the developer has to send. */}
                <span>
                  <span className="block">{scope.label}</span>
                  <code className="font-mono text-xs text-muted-foreground">{scope.value}</code>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <FormMessage state={state} okText="Key created." />
        <SubmitButton pendingLabel="Creating…">Create API key</SubmitButton>
      </form>
    </div>
  );
}
