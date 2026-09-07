'use client';

import { useFormState } from 'react-dom';
import { ConfirmSubmit } from '@/components/confirm-submit';
import { FormMessage } from '@/components/ui/form-message';
import { removeAgentWithFeedbackAction } from '../actions';

const initial = {};

/**
 * Remove a teammate, and say so when part of it did not work.
 *
 * Removal now also ends the person's session, and those are two separate
 * operations against two different systems: the membership row goes, then the
 * sessions do. The first is the security-critical half and must not be blocked
 * by the second, so a failed revocation leaves them removed but still holding a
 * live session until it expires.
 *
 * That is exactly the outcome an admin needs told. The page previously used the
 * plain `removeAgentAction`, whose return type React's `form action` prop pins
 * to `void`, so the message had nowhere to go and reached nobody — while the
 * confirmation text beside it promised the person "is signed out immediately".
 */
export function RemoveAgentForm({
  membershipId,
  personLabel,
}: {
  membershipId: string;
  personLabel: string;
}) {
  const [state, action] = useFormState(removeAgentWithFeedbackAction, initial);

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="membershipId" value={membershipId} />
      <ConfirmSubmit
        label="Remove from the team"
        confirmLabel="Yes, remove them"
        question={`${personLabel} is signed out immediately and can no longer open your inbox or see any customer details. Chats they already replied to are kept.`}
      />
      <FormMessage state={state} />
    </form>
  );
}
