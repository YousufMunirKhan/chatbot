'use client';

import { useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useFormState } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_RULES_TEXT,
  MAX_ATTACHMENT_BYTES,
  formatBytes,
} from '@/lib/attachments/policy';
import { sendAgentReplyAction, type ActionState } from '../inbox-actions';
import type { CannedResponse } from '../inbox-data';
import { CopilotBar } from './copilot-bar';

const initial: ActionState = {};

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
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [sentFile, setSentFile] = useState<string | null>(null);

  function insertCanned(id: string) {
    const canned = cannedResponses.find((c) => c.id === id);
    if (!canned || !textRef.current) return;
    const existing = textRef.current.value;
    textRef.current.value = existing ? `${existing}\n${canned.body}` : canned.body;
    textRef.current.focus();
  }

  function setDraft(text: string) {
    if (!textRef.current) return;
    textRef.current.value = text;
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

  /**
   * A file goes as its own message, the moment it is picked.
   *
   * It does not ride along with the text: the reply is a server action and a
   * 10 MB PDF would hold the whole submit open, so a two-line answer would sit
   * behind an upload. Sending them separately also means a rejected file never
   * costs the agent what they had typed.
   *
   * The size is checked here as well as on the server — not as security, which
   * is the server's job, but because telling somebody a 40 MB video is too big
   * is worth doing before they have uploaded 40 MB of it.
   */
  async function onPickFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Clear immediately so picking the same file twice still fires a change.
    e.target.value = '';
    if (!file) return;

    setFileError(null);
    setSentFile(null);

    if (file.size > MAX_ATTACHMENT_BYTES) {
      setFileError(
        `${file.name} is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_ATTACHMENT_BYTES)}.`,
      );
      return;
    }

    const body = new FormData();
    body.set('conversationId', conversationId);
    body.set('file', file);

    setUploading(true);
    try {
      const res = await fetch('/api/company/attachments', { method: 'POST', body });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setFileError(payload?.error?.message ?? 'That file could not be sent. Try again.');
        return;
      }
      const sent = (await res.json()) as { attachment?: { name?: string } };
      setSentFile(sent.attachment?.name ?? file.name);
      // The message is already in the database; pull the thread again so it
      // appears where every other message appears.
      router.refresh();
    } catch {
      setFileError('Could not reach the server. Check your connection and try again.');
    } finally {
      setUploading(false);
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
            // This inline picker runs smaller than either `Select` size, so it
            // overrides height/padding/type — but adopting the primitive still
            // buys it `border-input` and the focus ring its hand-rolled classes
            // lacked.
            <Select
              size="sm"
              aria-label="Insert canned response"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) insertCanned(e.target.value);
                e.target.value = '';
              }}
              className="h-8 w-auto px-2 text-xs"
            >
              <option value="">Insert saved reply…</option>
              {cannedResponses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
          ) : (
            <a
              href="/company/inbox/canned"
              className="text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              No saved replies yet — set one up
            </a>
          )}
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
      <CopilotBar
        conversationId={conversationId}
        getDraft={() => textRef.current?.value ?? ''}
        onText={setDraft}
      />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {/* Kept out of the form's own fields: this input is read by hand and
            posted to /api/company/attachments, never submitted with the reply. */}
        <input
          ref={fileRef}
          type="file"
          accept={ATTACHMENT_ACCEPT}
          onChange={onPickFile}
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? 'Sending file…' : 'Send a file'}
        </Button>
        <span className="text-xs text-muted-foreground">{ATTACHMENT_RULES_TEXT}</span>
      </div>

      {/* The upload does not go through `useFormState`, so it needs its own
          announced region rather than sharing the reply's. */}
      <p role={fileError ? 'alert' : 'status'} aria-live={fileError ? undefined : 'polite'} className="text-sm empty:hidden">
        {fileError ? (
          <span className="text-danger-fg">{fileError}</span>
        ) : sentFile ? (
          <span className="text-success-fg">Sent {sentFile}.</span>
        ) : null}
      </p>

      {/* Success is the reply appearing in the thread, so this region carries
          the failure branch only. */}
      <FormMessage state={{ error: state.error }} />
      <SubmitButton pendingLabel="Sending…">Send reply</SubmitButton>
    </form>
  );
}
