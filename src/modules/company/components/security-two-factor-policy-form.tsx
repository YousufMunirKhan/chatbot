'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { CHECKBOX, CHOICE_CARD } from './form-layout';
import { FormMessage } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import {
  setCompanyTwoFactorPolicyAction,
  type SecurityActionState,
} from '@/modules/company/security-actions';
import type { CompanyTwoFactorPolicy } from '@/lib/auth/two-factor';
import type { TeamTwoFactorSummary } from '@/modules/company/security-data';

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
 * The company-wide requirement — off unless somebody here turns it on.
 *
 * The form is deliberately explicit about consequences before the button is
 * pressed rather than after. Two-factor policies get switched on in a hurry
 * after a scare, and the support ticket that follows is always the same one:
 * "half my team cannot get in". So the number of people who have not enrolled
 * is on screen, the grace period is a field rather than a hidden constant, and
 * the sentence under the toggle says exactly what happens to somebody who has
 * not set it up yet.
 */
export function SecurityTwoFactorPolicyForm({
  policy,
  team,
  companyName,
}: {
  policy: CompanyTwoFactorPolicy;
  team: TeamTwoFactorSummary;
  companyName: string;
}) {
  const [state, action] = useFormState<SecurityActionState, FormData>(
    setCompanyTwoFactorPolicyAction,
    EMPTY,
  );
  const [required, setRequired] = useState(policy.required);
  const notEnrolled = Math.max(team.total - team.enrolled, 0);

  return (
    <Card>
      {/* `flex flex-row` without `space-y-0` left `CardHeader`'s own
          `space-y-1.5` in place, which in a row is a 6px top margin on the
          badge — visibly off the centre line `items-center` had just set. Every
          header of this shape in the product had the same 6px error.
          `flex-wrap`: at 375px the title here is a whole sentence, and an
          unwrapped badge beside it was squeezed to two characters wide. */}
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <CardTitle>Require two-step sign-in for everyone at {companyName}</CardTitle>
        <Badge variant={policy.required ? 'success' : 'secondary'}>
          {policy.required ? 'Required' : 'Not required'}
        </Badge>
      </CardHeader>

      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          This is off until you turn it on, and only you can turn it on. It applies to everyone with
          a login at {companyName} — {team.enrolled} of {team.total}{' '}
          {team.total === 1 ? 'person has' : 'people have'} already set it up.
        </p>

        <form action={action} className="space-y-4">
          <label className={CHOICE_CARD}>
            <input
              type="checkbox"
              name="required"
              className={CHECKBOX}
              defaultChecked={policy.required}
              onChange={(event) => setRequired(event.currentTarget.checked)}
            />
            <span>
              <span className="font-medium">Require two-step sign-in</span>
              <span className="block text-muted-foreground">
                Nobody is signed out and nobody is locked out today. People who have not set it up
                get a reminder, and are asked to set it up before they can carry on once the grace
                period below has passed.
              </span>
            </span>
          </label>

          <FormField
            label="Grace period"
            htmlFor="two-factor-grace"
            hint="Days from switching this on before someone who has not set it up is asked to. Set 0 to ask immediately."
          >
            <Input
              id="two-factor-grace"
              name="gracePeriodDays"
              type="number"
              min={0}
              max={90}
              step={1}
              defaultValue={policy.gracePeriodDays}
              className="max-w-[8rem]"
            />
          </FormField>

          {required && notEnrolled > 0 ? (
            <Alert tone="warning" title={`${notEnrolled} ${notEnrolled === 1 ? 'person has' : 'people have'} not set this up yet`}>
              They can keep working as normal during the grace period. After that, the next page they
              open asks them to set up an authenticator app before anything else. Nobody is ever
              signed out mid-conversation.
            </Alert>
          ) : null}

          {!required && policy.required ? (
            <Alert tone="danger" title="You are about to remove a security control">
              Saving this stops requiring two-step sign-in. People who already set it up keep it —
              this only stops asking everyone else. The change is recorded in your activity log with
              your name against it.
            </Alert>
          ) : null}

          {policy.required && policy.graceEndsAt ? (
            <p className="text-sm text-muted-foreground">
              Required since {formatDay(policy.requiredSince)}. People who have not set it up are
              asked to from {formatDay(policy.graceEndsAt)}.
            </p>
          ) : null}

          <FormMessage state={state} okText="Saved. It can take up to a minute to apply everywhere." />
          <SubmitButton>Save requirement</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
