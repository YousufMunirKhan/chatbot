'use client';

import { useState, useTransition } from 'react';
import { useFormState } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { formatNumber } from '@/lib/format';
import { companyDeletionPreviewAction, deleteCompanyAction } from '../actions';
import type { CompanyDeletionPreview } from '../deletion-data';

const CONFIRM_WORD = 'delete';
const initial = {};

/**
 * Deleting a company is irreversible and reaches further than the name
 * suggests, so the dialog does three things before it will submit.
 *
 * It shows the size of what goes: row counts pulled when the dialog opens, not
 * when the page renders, because most rows on the list will never be deleted.
 *
 * It names the logins, and separates the ones that go from the ones that stay.
 * "Delete the company" is a decision someone can make confidently; "delete
 * these three people's accounts" is a different decision, and it should not be
 * made by accident inside the first one.
 *
 * And it requires the word to be typed. A confirm button that is one reflexive
 * Enter away from firing is not a safeguard — the `AlertDialog` this is built
 * on says as much in its own notes, which is why the submit control stays
 * disabled until the field matches exactly.
 */
export function DeleteCompanyDialog({
  companyId,
  companyName,
}: {
  companyId: string;
  companyName: string;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [preview, setPreview] = useState<CompanyDeletionPreview | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [loading, startLoading] = useTransition();
  const [state, action] = useFormState(deleteCompanyAction, initial);

  const armed = typed.trim().toLowerCase() === CONFIRM_WORD;

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setTyped('');
      return;
    }
    if (preview || loading) return;
    startLoading(async () => {
      try {
        setPreview(await companyDeletionPreviewAction(companyId));
      } catch {
        // The dialog is still usable without the preview — it just cannot show
        // the size of what goes. Blocking the delete on a failed count would be
        // the wrong trade.
        setPreviewFailed(true);
      }
    });
  }

  const goingLogins = preview?.users.filter((u) => u.fate === 'delete') ?? [];
  const stayingLogins = preview?.users.filter((u) => u.fate === 'keep') ?? [];

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" className="text-destructive hover:text-destructive">
          Delete
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {companyName}?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the company and everything belonging to it. It cannot be undone, and there
            is no export afterwards.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4 text-sm">
          {loading ? (
            <p className="text-muted-foreground">Working out what would be deleted…</p>
          ) : previewFailed ? (
            <p className="text-muted-foreground">
              Could not load the summary. The delete still works, but you are doing it without
              seeing the size of it.
            </p>
          ) : preview ? (
            <>
              {preview.counts.length > 0 ? (
                <div>
                  <p className="mb-2 font-medium">This goes with it</p>
                  <ul className="space-y-1">
                    {preview.counts.map((c) => (
                      <li key={c.label} className="flex justify-between gap-4">
                        <span className="text-muted-foreground">{c.label}</span>
                        <span className="tabular-nums">{formatNumber(c.value)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Plus every setting, integration, bot, flow and report belonging to this company.
                  </p>
                </div>
              ) : (
                <p className="text-muted-foreground">
                  This company has no conversations, leads or documents stored.
                </p>
              )}

              {goingLogins.length > 0 ? (
                <div>
                  <p className="mb-2 font-medium">
                    {goingLogins.length === 1
                      ? 'This person loses their login'
                      : `These ${goingLogins.length} people lose their logins`}
                  </p>
                  <ul className="space-y-1">
                    {goingLogins.map((u) => (
                      <li key={u.id} className="text-muted-foreground">
                        {u.email}
                        {u.fullName ? ` — ${u.fullName}` : ''}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs text-muted-foreground">
                    They are only in this company, so their account has nothing left to sign in to.
                  </p>
                </div>
              ) : null}

              {stayingLogins.length > 0 ? (
                <div>
                  <p className="mb-2 font-medium">Keeping their login</p>
                  <ul className="space-y-1">
                    {stayingLogins.map((u) => (
                      <li key={u.id} className="text-muted-foreground">
                        {u.email} — {u.keptBecause}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : null}

          <form action={action} className="space-y-3 border-t pt-4">
            <input type="hidden" name="companyId" value={companyId} />
            <div className="space-y-1.5">
              <label htmlFor={`confirm-${companyId}`} className="font-medium">
                Type <span className="font-mono">{CONFIRM_WORD}</span> to confirm
              </label>
              <Input
                id={`confirm-${companyId}`}
                name="confirmation"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                placeholder={CONFIRM_WORD}
                aria-describedby={`confirm-${companyId}-hint`}
              />
              <p id={`confirm-${companyId}-hint`} className="text-xs text-muted-foreground">
                The button stays disabled until this matches.
              </p>
            </div>

            <FormMessage state={state} />

            <AlertDialogFooter>
              <AlertDialogCancel asChild>
                <Button type="button" variant="outline">
                  Keep this company
                </Button>
              </AlertDialogCancel>
              <SubmitButton
                variant="destructive"
                disabled={!armed}
                pendingLabel="Deleting…"
              >
                Delete {companyName}
              </SubmitButton>
            </AlertDialogFooter>
          </form>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
