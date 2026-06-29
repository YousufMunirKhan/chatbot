'use client';

import { useRef, type KeyboardEvent } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { sendAgentReplyAction, type ActionState } from '../inbox-actions';
import type { CannedResponse } from '../inbox-data';

const initial: ActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Sending…' : 'Send reply'}
    </Button>
  );
}

export function AgentReplyForm({
  conversationId,
  cannedResponses = [],
}: {
  conversationId: string;
  cannedResponses?: CannedResponse[];
}) {
  const [state, action] = useFormState(sendAgentReplyAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  function insertCanned(id: string) {
    const canned = cannedResponses.find((c) => c.id === id);
    if (!canned || !textRef.current) return;
    const existing = textRef.current.value;
    textRef.current.value = existing ? `${existing}\n${canned.body}` : canned.body;
    textRef.current.focus();
  }

  // Clear the box after the form data has been captured for the action.
  function clearSoon() {
    setTimeout(() => {
      if (textRef.current) textRef.current.value = '';
    }, 0);
  }

  // Enter sends; Shift+Enter inserts a new line.
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (textRef.current?.value.trim()) formRef.current?.requestSubmit();
    }
  }

  return (
    <form ref={formRef} action={action} onSubmit={clearSoon} className="space-y-3">
      <p className="text-sm text-muted-foreground">Replying pauses the AI for this conversation.</p>
      <input type="hidden" name="conversationId" value={conversationId} />
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="text">Your reply</Label>
          {cannedResponses.length > 0 ? (
            <select
              aria-label="Insert canned response"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) insertCanned(e.target.value);
                e.target.value = '';
              }}
              className="h-8 rounded-md border bg-background px-2 text-xs"
            >
              <option value="">Insert saved reply…</option>
              {cannedResponses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        <Textarea
          id="text"
          name="text"
          ref={textRef}
          onKeyDown={onKeyDown}
          required
          maxLength={4000}
          placeholder="Type your reply…  (Enter to send, Shift+Enter for a new line)"
        />
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <SubmitButton />
    </form>
  );
}
