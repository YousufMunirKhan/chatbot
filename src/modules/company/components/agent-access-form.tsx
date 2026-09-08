'use client';

import { useFormState } from 'react-dom';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { SubmitButton } from '@/components/ui/submit-button';
import { updateMemberAccessAction, type ActionState } from '../actions';
import {
  AgentAccessFields,
  type AccessGroupOption,
  type AccessRoleOption,
} from './agent-access-fields';

const initial: ActionState = {};

/**
 * Change what somebody already on the team can do.
 *
 * WHY THIS IS A DRAWER AND NOT A `<details>` IN THE ROW
 * ----------------------------------------------------
 * It used to be a disclosure that expanded in place. The reasoning — "an owner
 * opens this to read as often as to change, so keep the list visible" — was
 * right about the job and wrong about where the panel fits, because of where
 * this component actually renders: the LAST CELL of a five-column table, inside
 * the 1fr side of a `lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]` split.
 *
 * That cell is roughly 150px wide. Opening the disclosure pushed a role select
 * and nineteen described tick boxes into 150px; because `Table` wraps itself in
 * `overflow-auto`, the result was not a visible break but a silently
 * horizontally-scrolling table with a column of four-word-per-line text in it.
 * At 375px it was unusable in a different way — the panel was the width of the
 * scroll container, not of the screen.
 *
 * A drawer is the same interaction (open, read, adjust, save, the list is still
 * there behind it) at a size the content can actually be read at, and it is the
 * one shape that is identical on a phone and on a 1920px screen. `Sheet` brings
 * the focus trap, the Escape handler and the scrim with it.
 *
 * There is no control here for changing your own access, and no error message
 * about it either — the page does not render this on the caller's own row. The
 * server refuses it regardless: that is where the rule lives.
 */
export function AgentAccessForm({
  membershipId,
  personLabel,
  roles,
  groups,
  manageable,
  currentRole,
  currentPermissions,
}: {
  membershipId: string;
  personLabel: string;
  roles: AccessRoleOption[];
  groups: AccessGroupOption[];
  manageable: string[];
  currentRole: string;
  currentPermissions: string[];
}) {
  const [state, action] = useFormState(updateMemberAccessAction, initial);

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          Change access
          <span className="sr-only"> for {personLabel}</span>
        </Button>
      </SheetTrigger>
      {/* Wider than the default `max-w-sm` drawer: this one carries a tick list
          of nineteen permissions, each with a sentence. It stays a drawer at
          375px, where `w-3/4` and the cap both give way to the screen. */}
      <SheetContent className="w-full sm:max-w-xl">
        <form action={action} className="flex min-h-full flex-col">
          <SheetHeader>
            <SheetTitle>Access for {personLabel}</SheetTitle>
            <SheetDescription>
              Pick a role to set a sensible starting point, then tick or untick anything that
              should be different for this person.
            </SheetDescription>
          </SheetHeader>

          <SheetBody className="space-y-4">
            <input type="hidden" name="membershipId" value={membershipId} />
            <AgentAccessFields
              idPrefix={`member-${membershipId}`}
              roles={roles}
              groups={groups}
              manageable={manageable}
              initialRole={currentRole}
              initialGranted={currentPermissions}
            />
          </SheetBody>

          {/* The result sits with the button that produced it, and the footer is
              the one part of the drawer that never scrolls away — so a failure
              is not announced somewhere the user has already scrolled past. */}
          <SheetFooter className="sticky bottom-0 bg-card sm:items-center sm:justify-between">
            <FormMessage
              state={state}
              okText="Saved. It applies the next time they load a page."
              className="sm:me-auto"
            />
            <SubmitButton pendingLabel="Saving…">Save access</SubmitButton>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
