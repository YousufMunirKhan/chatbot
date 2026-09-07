'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useFormState } from 'react-dom';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import { formatAbsoluteTime } from '@/lib/relative-time';
import {
  snoozeConversationAction,
  wakeConversationAction,
  type ActionState,
} from '../inbox-actions';
import { SNOOZE_PRESETS, timeUntilLabel } from './inbox-snooze-presets';

const initial: ActionState = {};

/**
 * Put a conversation aside until a chosen time.
 *
 * A snoozed conversation leaves the working queues — waiting, mine, urgent —
 * and comes back on its own when the time passes. It does not leave
 * "Everything", and it gets its own queue on the rail, because the one thing
 * worse than a chat you cannot put down is a chat you cannot find again.
 *
 * The hidden offset field is what makes the picker mean what it says. A
 * `datetime-local` value carries no timezone, so the server would otherwise
 * read "14:30" as UTC and an agent in Dubai would get a four-hour surprise.
 */
export function ConversationSnooze({
  conversationId,
  snoozedUntil,
  snoozedByName,
}: {
  conversationId: string;
  snoozedUntil: string | null;
  snoozedByName: string | null;
}) {
  const router = useRouter();
  const [state, action] = useFormState(snoozeConversationAction, initial);
  const [isPending, startTransition] = useTransition();
  const [showPicker, setShowPicker] = useState(false);
  const offsetRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);

  // Read on the client, after hydration: the server rendering this markup is in
  // whatever zone the host runs in, which is nobody's.
  useEffect(() => {
    if (offsetRef.current) offsetRef.current.value = String(new Date().getTimezoneOffset());
  }, [showPicker]);

  function snoozeFor(preset: string) {
    const fd = new FormData();
    fd.set('conversationId', conversationId);
    fd.set('preset', preset);
    startTransition(async () => {
      await snoozeConversationAction(initial, fd);
      router.refresh();
    });
  }

  function wake() {
    const fd = new FormData();
    fd.set('conversationId', conversationId);
    startTransition(async () => {
      await wakeConversationAction(fd);
      router.refresh();
    });
  }

  const isSnoozed = Boolean(snoozedUntil && new Date(snoozedUntil).getTime() > Date.now());

  return (
    <div>
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Snooze
      </p>

      {isSnoozed ? (
        <div className="space-y-2">
          <p className="text-sm">
            Put aside until{' '}
            <time dateTime={snoozedUntil ?? undefined} className="font-medium">
              {formatAbsoluteTime(snoozedUntil)}
            </time>
            <span className="text-muted-foreground">
              {` (in ${timeUntilLabel(snoozedUntil)}${snoozedByName ? `, by ${snoozedByName}` : ''})`}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            It is out of the waiting, mine and urgent queues until then, and comes back on its own.
          </p>
          <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={wake}>
            {isPending ? 'Bringing it back…' : 'Bring it back now'}
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Waiting on the customer, or on someone else? Put it aside and it will come back to your
            queue by itself.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {SNOOZE_PRESETS.map((preset) => (
              <Button
                key={preset.key}
                type="button"
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() => snoozeFor(preset.key)}
              >
                {preset.label}
              </Button>
            ))}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={isPending}
              aria-expanded={showPicker}
              onClick={() => setShowPicker((open) => !open)}
            >
              Pick a time
            </Button>
          </div>

          {showPicker ? (
            <form action={action} className="space-y-2 rounded-md border p-3">
              <input type="hidden" name="conversationId" value={conversationId} />
              <input type="hidden" name="tzOffsetMinutes" ref={offsetRef} defaultValue="0" />
              <FormField
                label="Bring it back at"
                htmlFor={`snooze-until-${conversationId}`}
                hint="Your own time, not the visitor's."
              >
                <Input
                  id={`snooze-until-${conversationId}`}
                  type="datetime-local"
                  name="until"
                  required
                />
              </FormField>
              <SubmitButton size="sm" pendingLabel="Putting it aside…" disabled={isPending}>
                Snooze
              </SubmitButton>
            </form>
          ) : null}
        </div>
      )}

      <FormMessage state={state} okText="Put aside." className="mt-2" />
    </div>
  );
}
