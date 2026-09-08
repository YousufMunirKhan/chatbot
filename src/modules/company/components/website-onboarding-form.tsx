'use client';

import { useFormState } from 'react-dom';
import { Alert } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { importWebsiteOnboardingAction, type WebsiteImportState } from '../knowledge-actions';

const initial: WebsiteImportState = {};

export function WebsiteOnboardingForm() {
  const [state, action] = useFormState(importWebsiteOnboardingAction, initial);

  return (
    <div className="space-y-4">
      <form action={action} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        {/* `type="text"` on a field whose placeholder is an address: the
            browser offered no keyboard, no autofill and no format check, so
            "example.com" and "www.example.com/" both got as far as the server
            before failing. */}
        <FormField
          label="Your website address"
          htmlFor="websiteUrl"
          required
          hint="The home page, with https:// at the front. We read up to 8 pages from this same domain."
        >
          <Input
            name="websiteUrl"
            type="url"
            inputMode="url"
            placeholder="https://example.com"
            required
          />
        </FormField>
        <SubmitButton pendingLabel="Importing website…">Import website</SubmitButton>
      </form>

      <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
        Imports up to 8 public same-domain pages and indexes cleaned text as draft launch knowledge.
        Review important prices, policies, and contact details before publishing.
      </div>

      <FormMessage state={{ error: state.error }} />
      {state.ok ? (
        // The success side of this action is a rich block (lists of URLs and
        // prompts), which `FormMessage` cannot carry — it renders a single `<p>`.
        // So it is an `Alert tone="success"` given the live region by hand;
        // without `role="status"` the import would finish silently for a screen
        // reader. `border-emerald-200 bg-emerald-50 text-emerald-950` → the
        // success triplet, which is defined in dark mode too. The `space-y-3`
        // goes on an inner wrapper because `Alert` nests `children` two levels
        // below the element `className` lands on; padding is `Alert`'s own
        // `px-4 py-3` rather than the old `p-4`.
        <Alert tone="success" role="status" aria-live="polite">
          <div className="space-y-3">
            <p className="font-medium">
              Imported {state.pagesImported ?? 0} website page{state.pagesImported === 1 ? '' : 's'}
              .
            </p>
            {state.importedUrls?.length ? (
              <ul className="list-inside list-disc space-y-1 text-xs">
                {state.importedUrls.slice(0, 6).map((url) => (
                  <li key={url} className="break-all">
                    {url}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs">
                We could not read any public pages at that address. Check the URL, or paste your key
                details as text knowledge instead.
              </p>
            )}
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
              <p className="text-xs">
                No obvious gaps found from the public pages. Still run the launch tests below.
              </p>
            )}
          </div>
        </Alert>
      ) : null}
    </div>
  );
}
