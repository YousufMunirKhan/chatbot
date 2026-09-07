'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useTransition } from 'react';
import { useFormState } from 'react-dom';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { Select } from '@/components/ui/select';
import { SubmitButton } from '@/components/ui/submit-button';
import { formatRelativeTime } from '@/lib/relative-time';
import { assignConversationAction, type ActionState } from '../inbox-actions';
import type { InboxMemberOption } from '../inbox-data';

const initial: ActionState = {};

/**
 * Who is dealing with this, and how to hand it to someone else.
 *
 * Assignment used to happen only as a side effect of replying, so the honest
 * reading of an unassigned conversation was "nobody has typed in it yet" and
 * there was no way at all to pass one on. The line above the control says what
 * is true now — including who did the assigning, which is the question that
 * gets asked when work turns up on someone's queue unannounced.
 *
 * "Assign to me" is separate from the dropdown because it is the overwhelmingly
 * common case, and hunting for your own name in a list of forty is not a thing
 * anyone should do to pick up a chat.
 */
export function ConversationAssign({
  conversationId,
  members,
  currentUserId,
  assignedAgentId,
  assignedAgentName,
  assignedByName,
  assignedAt,
}: {
  conversationId: string;
  members: InboxMemberOption[];
  currentUserId: string;
  assignedAgentId: string | null;
  assignedAgentName: string | null;
  assignedByName: string | null;
  assignedAt: string | null;
}) {
  const router = useRouter();
  const [state, action] = useFormState(assignConversationAction, initial);
  const [isPending, startTransition] = useTransition();

  // The action updates a row this page has already rendered, so the panel has
  // to ask for the new one. `revalidatePath` alone only marks it stale.
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);

  function assignToMe() {
    const fd = new FormData();
    fd.set('conversationId', conversationId);
    fd.set('assigneeId', currentUserId);
    startTransition(async () => {
      await assignConversationAction(initial, fd);
      router.refresh();
    });
  }

  const isMine = assignedAgentId === currentUserId;
  const assignedByOther = assignedByName && assignedAgentName !== assignedByName;

  return (
    <div>
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Assigned to
      </p>
      <p className="mb-2 text-sm">
        {assignedAgentName ? (
          <>
            <span className="font-medium">{isMine ? 'You' : assignedAgentName}</span>
            {assignedByOther ? (
              <span className="text-muted-foreground"> · handed over by {assignedByName}</span>
            ) : null}
            {assignedAt ? (
              <span className="text-muted-foreground"> · {formatRelativeTime(assignedAt)}</span>
            ) : null}
          </>
        ) : (
          <span className="text-muted-foreground">Nobody yet — it is in the unassigned pile.</span>
        )}
      </p>

      <form action={action} className="space-y-2">
        <input type="hidden" name="conversationId" value={conversationId} />
        <FormField label="Hand it to" htmlFor={`assignee-${conversationId}`}>
          <Select
            id={`assignee-${conversationId}`}
            name="assigneeId"
            size="sm"
            defaultValue={assignedAgentId ?? 'unassigned'}
            disabled={isPending}
          >
            <option value="unassigned">Nobody — back to the pile</option>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.userId === currentUserId ? `${member.name} (you)` : member.name}
              </option>
            ))}
          </Select>
        </FormField>
        <div className="flex flex-wrap items-center gap-2">
          <SubmitButton size="sm" variant="outline" pendingLabel="Handing over…" disabled={isPending}>
            Assign
          </SubmitButton>
          {!isMine ? (
            <Button type="button" size="sm" disabled={isPending} onClick={assignToMe}>
              {isPending ? 'Taking it…' : 'Assign to me'}
            </Button>
          ) : null}
        </div>
        <FormMessage state={state} okText="Assignment saved." />
      </form>
    </div>
  );
}
