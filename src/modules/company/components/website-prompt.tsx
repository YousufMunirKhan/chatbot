'use client';

import * as React from 'react';
import Link from 'next/link';
import { useFormState } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import { importWebsiteOnboardingAction, type WebsiteImportState } from '../knowledge-actions';

/**
 * "Give us your website address" — on the home page, for whoever skipped it.
 *
 * WHY IT IS HERE AT ALL
 * ---------------------
 * The website import is the first step of setup now, and it is skippable, so a
 * company can get all the way to a working assistant having waved it away once.
 * For a business that HAS a website that is the wrong outcome: the pages are
 * sitting there, they answer most of what customers ask, and the owner is
 * instead typing services and opening hours into forms by hand. So the home
 * page asks once more, in the place they open every morning, with the box to
 * answer it in rather than a link to a page with a box on it.
 *
 * WHEN IT STOPS — THE THREE WAYS
 * ------------------------------
 *  1. `done` goes true the moment any page has been crawled, and the prompt
 *     never renders again. It is the website step's own completion from
 *     `setup-data`, which rests on `websiteImport` — the product's single
 *     definition of "we have read their site". `companies.website` is
 *     deliberately NOT that definition: an address can be typed onto a company
 *     nothing ever read, and the first live tenant is exactly that case.
 *  2. `done` is also true for a company with no address on file that supplied
 *     those facts by hand. There is nothing left to import, so nothing to ask.
 *  3. "Not now" snoozes it for {@link SNOOZE_DAYS} days.
 *
 * WHY A SNOOZE AND NOT A DISMISSAL
 * --------------------------------
 * A banner that never goes away is nagging, and the honest reading of a click
 * on it is "leave me alone", not "never mention this again". But a permanent
 * dismissal on day one throws away the whole point: the owner who is busiest in
 * their first week is exactly the one whose assistant is answering out of an
 * empty knowledge base. A week is long enough that it is not in the way, and
 * short enough to catch them once they have time. The card says so out loud —
 * a snooze the reader cannot see the shape of is just a broken dismiss button.
 *
 * WHERE THE SNOOZE LIVES
 * ----------------------
 * `localStorage`, keyed by company id, for the reasons written out at length in
 * `src/modules/onboarding/components/guide-skip.tsx`: "not today" is intent,
 * it is worth nothing to anybody but the person who clicked, and losing it costs
 * one dismissed card rather than a support ticket. A column would be a second,
 * staler answer to a question the product can already answer.
 */

const SNOOZE_DAYS = 7;
const SNOOZE_MS = SNOOZE_DAYS * 24 * 60 * 60 * 1000;

function storageKey(companyId: string): string {
  return `company-home:${companyId}:website-prompt-snoozed-until`;
}

function snoozedUntil(companyId: string): number {
  try {
    const raw = window.localStorage.getItem(storageKey(companyId));
    const parsed = raw ? Number(raw) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    // Private windows, cleared site data and browsers set to block storage all
    // land here. Nothing about this card is worth breaking a page over, and
    // failing open means the worst case is being asked again.
    return 0;
  }
}

export interface WebsitePromptLabels {
  title: string;
  body: string;
  /** The field's own label. Never the card heading — a heading is not a label. */
  fieldLabel: string;
  fieldHint: string;
  /** Replaces `fieldHint` when the box was prefilled from `companies.website`. */
  onFile: string;
  submit: string;
  submitPending: string;
  dismiss: string;
  dismissNote: string;
  /**
   * Singular and plural as two strings, not one with a `{count}` and an "(s)".
   * Arabic does not pluralise the way English does, and "1 pages" is the kind of
   * detail that makes a product feel unfinished — the same reason the queue
   * headlines on this page are split in two.
   */
  importedOne: string;
  /** Carries `{count}`, substituted here because the count is only known once
   * the action has returned and the dictionary lives on the server. */
  importedMany: string;
  importedLink: string;
  /** Heading of the connected row, once a site has actually been read. */
  connectedTitle: string;
  /** Carries `{date}` — when it was last read. */
  connectedBody: string;
  /** The resync control. */
  refresh: string;
  refreshPending: string;
}

export interface WebsitePromptProps {
  /** Scopes the snooze, so one browser used for two tenants cannot mix them up. */
  companyId: string;
  /**
   * Whether the website step is finished — either because the site has been
   * read, or because there is no site to read and the facts arrived another
   * way. The card renders nothing when this is true, except on the render
   * immediately after its own submission made it true, so the owner sees their
   * import confirmed rather than the card blinking out.
   */
  done: boolean;
  /** `companies.website`, to prefill. Not evidence of an import. */
  defaultUrl?: string | null;
  /**
   * When the site was last read, already formatted. Its presence — not
   * `defaultUrl`, and not `done` — is what proves an import happened, so it is
   * what switches this card into its connected/resync state. `done` alone is
   * not enough: it is also true for a business with no website at all, which
   * has nothing to resync.
   */
  lastReadAt?: string | null;
  /**
   * Whether this card carries the page's single solid button. It does only
   * where it is the whole answer to "what should I do next"; anywhere a waiting
   * customer or an unmade assistant is on the same screen, that outranks it.
   */
  solid?: boolean;
  labels: WebsitePromptLabels;
}

const initial: WebsiteImportState = {};

export function WebsitePrompt({
  companyId,
  done,
  defaultUrl,
  lastReadAt,
  solid = false,
  labels,
}: WebsitePromptProps) {
  const [state, action] = useFormState(importWebsiteOnboardingAction, initial);
  const [snoozed, setSnoozed] = React.useState(false);

  // Read after mount, not during render: `localStorage` does not exist on the
  // server, and a value read in a lazy initialiser would make the server and
  // the client disagree about the markup. The cost is that somebody who has
  // snoozed sees the card for one frame; the alternative — rendering nothing
  // until mount — moves the whole page for everybody who has not.
  React.useEffect(() => {
    setSnoozed(snoozedUntil(companyId) > Date.now());
  }, [companyId]);

  const snooze = React.useCallback(() => {
    try {
      window.localStorage.setItem(storageKey(companyId), String(Date.now() + SNOOZE_MS));
    } catch {
      /* see snoozedUntil — the card simply comes back on the next load */
    }
    setSnoozed(true);
  }, [companyId]);

  // The import just happened. `revalidatePath('/company')` has already rebuilt
  // the page around this card, so `done` is true and every other reason to
  // render is gone — but the owner pressed a button and is owed the answer.
  if (state.ok) {
    const pages = state.pagesImported ?? 0;
    return (
      <Card>
        {/* Announced politely: the button the owner pressed has just been
            removed from the page, so without a live region a screen-reader user
            is told nothing at all about how a 20-second import ended. */}
        <CardContent className="space-y-2 p-6" role="status" aria-live="polite">
          <h2 className="text-base font-semibold">
            {pages === 1 ? labels.importedOne : labels.importedMany.replace('{count}', String(pages))}
          </h2>
          <p className="text-sm text-muted-foreground">
            <Link
              href="/company/business-data?tab=knowledge"
              className="underline underline-offset-4"
            >
              {labels.importedLink}
            </Link>
          </p>
        </CardContent>
      </Card>
    );
  }

  // A site that HAS been read keeps a place on this page — one line, the
  // address, when it was last read, and a way to read it again.
  //
  // The card used to return null here, on the reasoning that asking again reads
  // as an outstanding job. That is right about ASKING and wrong about the site
  // the owner has already connected: their prices, hours and policies change,
  // and until now the only way to pick that up was a "Refresh this site" button
  // three navigations away on the knowledge tab, which nobody found — the same
  // burial that kept the import itself from ever running.
  //
  // Re-running the import IS the resync: `importWebsiteOnboardingAction`
  // updates the pages it already holds rather than adding a second copy, which
  // is why this needs no separate action and no crawl id.
  if (done && lastReadAt && defaultUrl) {
    return (
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{labels.connectedTitle}</p>
            <p className="truncate text-xs text-muted-foreground">
              {labels.connectedBody.replace('{date}', lastReadAt)}
            </p>
          </div>
          <form action={action} className="shrink-0">
            <input type="hidden" name="websiteUrl" value={defaultUrl} />
            <SubmitButton size="sm" variant="outline" pendingLabel={labels.refreshPending}>
              {labels.refresh}
            </SubmitButton>
          </form>
        </CardContent>
      </Card>
    );
  }

  // An import happened but no address was recorded, so there is nothing to
  // resubmit. That gap is real: `importWebsiteOnboardingAction` writes
  // `companies.website` at the END of the run, so a crawl that dies part-way
  // leaves documents behind with no address — which is exactly what the 3072-
  // dimension embedding failure did. Falling through to the ask below lets the
  // owner supply it and finish the job. Returning null here, which is what the
  // first version of this card did, left them with an import they could see on
  // the knowledge tab and no way to complete or repeat it.
  //
  // A business with no website at all (`done`, no import) still gets nothing —
  // there is no site to read and no question worth asking.
  if ((done && !lastReadAt) || snoozed) return null;

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{labels.title}</h2>
          <p className="max-w-xl text-sm text-muted-foreground">{labels.body}</p>
        </div>

        {/* The field and the button on one row from `sm` up, stacked below it.
            `min-w-0` on the field because a grid child defaults to
            `min-width:auto`, and a long prefilled address would otherwise push
            the button off the card. */}
        <form action={action} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <FormField
            label={labels.fieldLabel}
            htmlFor="homeWebsiteUrl"
            required
            hint={defaultUrl ? labels.onFile : labels.fieldHint}
            className="min-w-0"
          >
            <Input
              name="websiteUrl"
              type="url"
              inputMode="url"
              placeholder="https://example.com"
              defaultValue={defaultUrl ?? undefined}
              required
            />
          </FormField>
          <SubmitButton variant={solid ? 'default' : 'outline'} pendingLabel={labels.submitPending}>
            {labels.submit}
          </SubmitButton>
        </form>

        <FormMessage state={{ error: state.error }} />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Button type="button" variant="ghost" size="sm" onClick={snooze}>
            {labels.dismiss}
          </Button>
          <span className="text-xs text-muted-foreground">{labels.dismissNote}</span>
        </div>
      </CardContent>
    </Card>
  );
}
