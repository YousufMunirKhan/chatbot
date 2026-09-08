'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import {
  cancelTwoFactorEnrolmentAction,
  confirmTwoFactorEnrolmentAction,
  disableMyTwoFactorAction,
  regenerateRecoveryCodesAction,
  startTwoFactorEnrolmentAction,
  type SecurityActionState,
} from '@/modules/company/security-actions';
import type { TwoFactorPanel } from '@/modules/company/security-data';

const EMPTY: SecurityActionState = {};

/**
 * The focus ring every control in this product shows, for the four bare
 * `<button>`s and `<summary>`s on this card that showed none at all.
 *
 * They are not `Button`s on purpose — they are quiet inline controls inside a
 * paragraph of explanation — but "not a Button" was being read as "not
 * focusable-looking", and this card is the one screen where a keyboard-only
 * user has to get every step right in order.
 */
const RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

function formatDay(value: string | null): string {
  if (!value) return '';
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * The recovery codes, at the only moment they exist.
 *
 * Rendered from `useFormState` rather than from the server, because the server
 * has only their hashes — by design. If this panel is dismissed or the tab is
 * closed, the codes are gone for good and the only way to get more is to prove
 * a current authenticator code, so the copy says so plainly rather than leaving
 * somebody to discover it later.
 */
function RecoveryCodes({ codes }: { codes: string[] }) {
  const [copyState, setCopyState] = useState<'idle' | 'done' | 'failed'>('idle');
  return (
    <Alert tone="warning" title="Save these recovery codes now">
      <p>
        Each one signs you in once if you lose your phone. We cannot show them again — we only keep
        a scrambled copy — so put them somewhere you can reach without this account.
      </p>
      {/* A floor, not a count. `sm:grid-cols-2` is a viewport query on a list
          inside an alert inside a card, and these are fixed-width mono codes —
          the question is whether two of THEM fit, which only the container can
          answer. */}
      <ul className="my-3 grid gap-1 font-mono text-sm [grid-template-columns:repeat(auto-fit,minmax(9rem,1fr))]">
        {codes.map((code) => (
          <li key={code} className="rounded border bg-background px-2 py-1 tracking-wider">
            {code}
          </li>
        ))}
      </ul>
      {/*
        This is the one moment these codes exist, and the old control got both
        halves of that wrong.

        `.catch(() => setCopied(false))` set the state it was already in, so a
        clipboard the browser refused — which is every insecure origin, and
        Safari outside a user gesture — looked exactly like never having pressed
        the button. Somebody would close the panel believing the codes were
        saved. A refusal now says so, and says what to do instead.

        And it was a bare `<button>` with an underline and no focus ring, on a
        panel whose entire job is to be acted on once. Every other control in
        the product shows focus; this one did not.
      */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={`rounded-md text-sm font-medium underline underline-offset-4 ${RING}`}
          onClick={() => {
            void navigator.clipboard
              ?.writeText(codes.join('\n'))
              .then(() => setCopyState('done'))
              .catch(() => setCopyState('failed'));
          }}
        >
          {/* Was "Copy all ten" against a list rendered from `codes.length`. */}
          Copy all {codes.length}
        </button>
        {/* Announced as well as shown: the button's own label does not change,
            so without a live region a screen-reader user gets nothing back. */}
        <p role="status" aria-live="polite" className="text-sm empty:hidden">
          {copyState === 'done'
            ? 'Copied to your clipboard.'
            : copyState === 'failed'
              ? 'Your browser would not let us reach the clipboard — select the codes above and copy them yourself.'
              : null}
        </p>
      </div>
    </Alert>
  );
}

export function SecurityTwoFactorCard({ panel }: { panel: TwoFactorPanel }) {
  const [startState, startAction] = useFormState<SecurityActionState, FormData>(
    startTwoFactorEnrolmentAction,
    EMPTY,
  );
  const [cancelState, cancelAction] = useFormState<SecurityActionState, FormData>(
    cancelTwoFactorEnrolmentAction,
    EMPTY,
  );
  const [confirmState, confirmAction] = useFormState<SecurityActionState, FormData>(
    confirmTwoFactorEnrolmentAction,
    EMPTY,
  );
  const [regenState, regenAction] = useFormState<SecurityActionState, FormData>(
    regenerateRecoveryCodesAction,
    EMPTY,
  );
  const [disableState, disableAction] = useFormState<SecurityActionState, FormData>(
    disableMyTwoFactorAction,
    EMPTY,
  );
  const [showSecret, setShowSecret] = useState(false);
  const [showDisable, setShowDisable] = useState(false);

  // Whichever action last produced codes wins. This component never unmounts
  // between the action and the re-render, which is the only reason the codes
  // survive long enough to be read.
  const freshCodes = confirmState.recoveryCodes ?? regenState.recoveryCodes ?? null;

  return (
    <Card>
      {/* `flex flex-row` without `space-y-0` left `CardHeader`'s own
          `space-y-1.5` in place, which in a row is a 6px top margin on the
          badge — visibly off the centre line `items-center` had just set. Every
          header of this shape in the product had the same 6px error.
          `flex-wrap`: at 375px the title here is a whole sentence, and an
          unwrapped badge beside it was squeezed to two characters wide. */}
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle>Two-step sign-in</CardTitle>
        <Badge variant={panel.status === 'on' ? 'success' : panel.status === 'pending' ? 'warning' : 'secondary'}>
          {panel.status === 'on' ? 'On' : panel.status === 'pending' ? 'Half set up' : 'Off'}
        </Badge>
      </CardHeader>

      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          After your password, we ask for a six-digit code from an authenticator app on your phone —
          Google Authenticator, Microsoft Authenticator, 1Password, Authy, any of them. Somebody who
          steals your password still cannot sign in without your phone.
        </p>

        {freshCodes ? <RecoveryCodes codes={freshCodes} /> : null}

        {panel.status === 'off' ? (
          <form action={startAction} className="space-y-3">
            <FormMessage state={startState} okText="" />
            <SubmitButton pendingLabel="Preparing…">Set up two-step sign-in</SubmitButton>
          </form>
        ) : null}

        {panel.status === 'pending' && panel.enrolment ? (
          <div className="space-y-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <div
                className="w-40 shrink-0 self-center rounded-md border p-2 text-foreground sm:self-start"
                // Generated on the server by our own encoder from the otpauth URI
                // below — no user-supplied markup reaches this.
                dangerouslySetInnerHTML={{ __html: panel.enrolment.qrSvg }}
              />
              <div className="min-w-0 flex-1 space-y-2 text-sm">
                <p className="font-medium">Scan this with your authenticator app.</p>
                <p className="text-muted-foreground">
                  It will be saved as <strong>{panel.companyName}</strong> ({panel.accountEmail}).
                </p>
                {/*
                  On a phone this is the whole job: the browser hands the
                  otpauth:// link to whichever authenticator is installed and
                  the account appears, no camera involved. On a desktop nothing
                  claims the scheme and the link does nothing, so it sits below
                  the QR code rather than in place of it.
                */}
                <p>
                  <a
                    href={panel.enrolment.uri}
                    className="font-medium underline underline-offset-4"
                  >
                    On this phone? Open your authenticator app
                  </a>
                </p>
                {/* A control that shows and hides something has to say which
                    it is doing, and it has to show focus. This one did neither:
                    `underline` was its entire styling, so a keyboard user
                    tabbing to the one escape hatch for a phone that cannot scan
                    got no indication they had reached it, and a screen reader
                    was never told the secret had appeared. */}
                <button
                  type="button"
                  className={`rounded-md font-medium underline underline-offset-4 ${RING}`}
                  onClick={() => setShowSecret((value) => !value)}
                  aria-expanded={showSecret}
                  aria-controls="two-factor-secret"
                >
                  {showSecret ? 'Hide the code to type in' : 'Cannot scan? Type it in instead'}
                </button>
                {showSecret ? (
                  <p
                    id="two-factor-secret"
                    className="break-all rounded border bg-muted/40 px-2 py-1 font-mono text-xs tracking-wider"
                  >
                    {panel.enrolment.secretForDisplay}
                  </p>
                ) : null}
              </div>
            </div>

            <Alert tone="info">
              Nothing changes on your account until you enter a working code below. If you close this
              page now, two-step sign-in stays off.
            </Alert>

            <form action={confirmAction} className="space-y-3">
              <FormField
                label="Enter the six digits your app is showing"
                htmlFor="two-factor-confirm"
                required
                hint="The code changes every 30 seconds. If it keeps failing, check your phone's clock is set automatically."
              >
                <Input
                  id="two-factor-confirm"
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  maxLength={7}
                  required
                />
              </FormField>
              <FormMessage state={confirmState} okText="Two-step sign-in is on." />
              <SubmitButton pendingLabel="Checking…">Turn it on</SubmitButton>
            </form>

            <form action={cancelAction}>
              <FormMessage state={cancelState} okText="" />
              <SubmitButton variant="outline" pendingLabel="Discarding…">
                Start again
              </SubmitButton>
            </form>
          </div>
        ) : null}

        {panel.status === 'on' ? (
          <div className="space-y-4">
            <div className="rounded-md border p-3 text-sm">
              <p>
                {panel.method === 'totp'
                  ? `Your authenticator app has been in use since ${formatDay(panel.confirmedAt)}.`
                  : 'Your account uses an emailed code.'}
              </p>
              <p className="text-muted-foreground">
                {panel.recoveryCodesRemaining > 0
                  ? `${panel.recoveryCodesRemaining} unused recovery ${panel.recoveryCodesRemaining === 1 ? 'code' : 'codes'} left.`
                  : 'No recovery codes left — generate a new set before you lose your phone.'}
              </p>
            </div>

            {panel.method === 'totp' ? (
              <details className="rounded-md border p-3">
                {/* `<summary>` is focusable and the preflight strips its
                    outline, so this was a control a keyboard could reach and
                    could not see. `rounded-sm` keeps the ring off the panel's
                    own corner. */}
                <summary
                  className={`cursor-pointer rounded-sm text-sm font-medium ${RING}`}
                >
                  Generate new recovery codes
                </summary>
                <form action={regenAction} className="mt-3 space-y-3">
                  <p className="text-sm text-muted-foreground">
                    This retires every code you already have. Prove it is you first.
                  </p>
                  <FormField
                    label="Code from your app, or a recovery code"
                    htmlFor="two-factor-regen"
                    required
                  >
                    <Input
                      id="two-factor-regen"
                      name="code"
                      autoComplete="one-time-code"
                      placeholder="123456"
                      maxLength={13}
                      required
                    />
                  </FormField>
                  <FormMessage state={regenState} okText="" />
                  {/* "Generate ten new codes" was a number written into the
                      copy. The count comes from the server; the button no
                      longer promises a figure it does not know. */}
                  <SubmitButton variant="outline" pendingLabel="Generating…">
                    Generate a new set
                  </SubmitButton>
                </form>
              </details>
            ) : null}

            {panel.policy.required ? (
              <Alert tone="info">
                {panel.companyName} requires two-step sign-in, so it cannot be turned off on your
                account. An owner or admin can lift the requirement below first.
              </Alert>
            ) : (
              <div>
                {showDisable ? (
                  <form action={disableAction} className="space-y-3 rounded-md border p-3">
                    <p className="text-sm text-muted-foreground">
                      Confirm with a code to prove it is you. Your recovery codes are destroyed at
                      the same time.
                    </p>
                    <FormField
                      label="Code from your app, or a recovery code"
                      htmlFor="two-factor-disable"
                      required
                    >
                      <Input
                        id="two-factor-disable"
                        name="code"
                        autoComplete="one-time-code"
                        placeholder="123456"
                        maxLength={13}
                        required
                      />
                    </FormField>
                    <FormMessage state={disableState} okText="Two-step sign-in is off." />
                    <SubmitButton variant="destructive" pendingLabel="Turning off…">
                      Turn two-step sign-in off
                    </SubmitButton>
                  </form>
                ) : (
                  // This is the one control on the page that removes a
                  // security protection, and it was the quietest thing on it —
                  // muted grey, underlined, no focus ring, indistinguishable
                  // from a help link. It stays understated (it only REVEALS the
                  // confirm step, it does not disable anything), but it is now
                  // reachable by keyboard with a visible ring, and it says that
                  // a confirmation follows so nobody presses it expecting the
                  // account to change.
                  <button
                    type="button"
                    className={`rounded-md text-sm font-medium text-muted-foreground underline underline-offset-4 ${RING}`}
                    onClick={() => setShowDisable(true)}
                    aria-expanded={false}
                  >
                    Turn two-step sign-in off…
                  </button>
                )}
              </div>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
