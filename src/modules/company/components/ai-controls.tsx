'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import {
  closeChatAction,
  pauseAiAction,
  resumeAiAction,
  type ActionState,
} from '@/modules/company/inbox-actions';

type Action = (formData: FormData) => Promise<ActionState>;

function labelFor(actionName: 'pause' | 'resume' | 'close', pending: boolean): string {
  if (actionName === 'pause') return pending ? 'Pausing AI...' : 'Pause AI';
  if (actionName === 'resume') return pending ? 'Resuming AI...' : 'Resume AI';
  return pending ? 'Closing...' : 'Close chat';
}

export function AiControls({
  conversationId,
  aiEnabled,
  isClosed,
}: {
  conversationId: string;
  aiEnabled: boolean;
  isClosed: boolean;
}) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<'pause' | 'resume' | 'close' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function run(actionName: 'pause' | 'resume' | 'close', action: Action) {
    setError(null);
    setPendingAction(actionName);
    const formData = new FormData();
    formData.set('conversationId', conversationId);

    startTransition(async () => {
      const result = await action(formData);
      if (result.error) {
        setError(result.error);
      } else {
        router.refresh();
      }
      setPendingAction(null);
    });
  }

  const busy = isPending || pendingAction !== null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {aiEnabled ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || isClosed}
            onClick={() => run('pause', pauseAiAction)}
          >
            {labelFor('pause', pendingAction === 'pause')}
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => run('resume', resumeAiAction)}
          >
            {labelFor('resume', pendingAction === 'resume')}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy || isClosed}
          onClick={() => run('close', closeChatAction)}
        >
          {labelFor('close', pendingAction === 'close')}
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
