'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import {
  closeChatAction,
  pauseAiAction,
  resumeAiAction,
  type ActionState,
} from '@/modules/company/inbox-actions';

type Action = (formData: FormData) => Promise<ActionState>;

/**
 * The assistant on/off control, as one switch.
 *
 * It used to be two alternating buttons — "Pause AI" when on, "Resume AI" when
 * off — which never showed a state, only the opposite action, and was shadowed
 * by a separate "AI on"/"AI off" badge in the header saying the same thing.
 * A single `role="switch"` with `aria-checked` states the truth once and is
 * announced correctly by screen readers.
 *
 * RTL note: the thumb is positioned with flex justification rather than a
 * physical `translate-x`, so "on" is the reading-end side in both directions.
 */
export function ConversationAiToggle({
  conversationId,
  aiEnabled,
  isClosed,
}: {
  conversationId: string;
  aiEnabled: boolean;
  isClosed: boolean;
}) {
  const router = useRouter();
  const labelId = useId();
  const [pendingAction, setPendingAction] = useState<'toggle' | 'close' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function run(actionName: 'toggle' | 'close', action: Action) {
    setError(null);
    setPendingAction(actionName);
    const formData = new FormData();
    formData.set('conversationId', conversationId);

    startTransition(async () => {
      const result = await action(formData);
      if (result.error) setError(result.error);
      else router.refresh();
      setPendingAction(null);
    });
  }

  const busy = isPending || pendingAction !== null;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span id={labelId} className="text-sm">
            Assistant replies
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={aiEnabled}
            aria-labelledby={labelId}
            disabled={busy || isClosed}
            onClick={() => run('toggle', aiEnabled ? pauseAiAction : resumeAiAction)}
            className={[
              'inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              'disabled:cursor-not-allowed disabled:opacity-50',
              aiEnabled ? 'justify-end bg-primary' : 'justify-start bg-input',
            ].join(' ')}
          >
            <span aria-hidden="true" className="h-5 w-5 rounded-full bg-background shadow" />
          </button>
        </div>
        {!isClosed ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => run('close', closeChatAction)}
          >
            {pendingAction === 'close' ? 'Sorting…' : 'Mark as sorted'}
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {isClosed
          ? 'This chat is sorted.'
          : aiEnabled
            ? 'Turn this off to take over yourself.'
            : 'You are handling this chat.'}
      </p>
      {/* `--destructive` is the solid fill behind white button text; reading
          body copy in it is unverified. `--danger-fg` is the token measured for
          text, and `role="alert"` is what makes a failure that appears after a
          click actually reach a screen reader. */}
      {error ? (
        <p role="alert" className="text-sm text-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}
