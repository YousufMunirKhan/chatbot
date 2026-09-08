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
  const [copied, setCopied] = useState(false);
  return (
    <Alert tone="warning" title="Save these recovery codes now">
      <p>
        Each one signs you in once if you lose your phone. We cannot show them again — we only keep
        a scrambled copy — so put them somewhere you can reach without this account.
      </p>
      <ul className="my-3 grid gap-1 font-mono text-sm sm:grid-cols-2">
        {codes.map((code) => (
          <li key={code} className="rounded border bg-background px-2 py-1 tracking-wider">
            {code}
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="text-sm font-medium underline underline-offset-4"
        onClick={() => {
          void navigator.clipboard
            ?.writeText(codes.join('\n'))
            .then(() => setCopied(true))
            .catch(() => setCopied(false));
        }}
      >
        {copied ? 'Copied to your clipboard' : 'Copy all ten'}
      </button>
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
      <CardHeader className="flex flex-row items-center justify-between gap-3">
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
                <button
                  type="button"
                  className="font-medium underline underline-offset-4"
                  onClick={() => setShowSecret((value) => !value)}
                >
                  {showSecret ? 'Hide the code to type in' : 'Cannot scan? Type it in instead'}
                </button>
                {showSecret ? (
                  <p className="break-all rounded border bg-muted/40 px-2 py-1 font-mono text-xs tracking-wider">
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
                <summary className="cursor-pointer text-sm font-medium">
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
                  <SubmitButton variant="outline" pendingLabel="Generating…">
                    Generate ten new codes
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
                  <button
                    type="button"
                    className="text-sm font-medium text-muted-foreground underline underline-offset-4"
                    onClick={() => setShowDisable(true)}
                  >
                    Turn two-step sign-in off
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
