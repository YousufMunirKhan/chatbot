'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  importWebsiteOnboardingAction,
  type WebsiteImportState,
} from '../knowledge-actions';

const initial: WebsiteImportState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Importing website...' : 'Import website'}
    </Button>
  );
}

export function WebsiteOnboardingForm() {
  const [state, action] = useFormState(importWebsiteOnboardingAction, initial);

  return (
    <div className="space-y-4">
      <form action={action} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="websiteUrl">Website URL</Label>
          <Input
            id="websiteUrl"
            name="websiteUrl"
            type="text"
            placeholder="https://example.com"
            required
          />
        </div>
        <SubmitButton />
      </form>

      <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
        Imports up to 8 public same-domain pages and indexes cleaned text as draft launch
        knowledge. Review important prices, policies, and contact details before publishing.
      </div>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.ok ? (
        <div className="space-y-3 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
          <p className="font-medium">
            Imported {state.pagesImported ?? 0} website page{state.pagesImported === 1 ? '' : 's'}.
          </p>
          {state.importedUrls?.length ? (
            <ul className="list-inside list-disc space-y-1 text-xs">
              {state.importedUrls.slice(0, 6).map((url) => (
                <li key={url} className="break-all">{url}</li>
              ))}
            </ul>
          ) : null}
          {state.missingPrompts?.length ? (
            <div>
              <p className="font-medium">Ask the client for these missing details next:</p>
              <ul className="mt-1 list-inside list-disc space-y-1 text-xs">
                {state.missingPrompts.map((prompt) => (
                  <li key={prompt}>{prompt}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs">No obvious gaps found from the public pages. Still run the launch tests below.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
