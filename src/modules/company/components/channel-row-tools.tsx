'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import {
  sendChannelTestMessageAction,
  updateChannelCommentSettingsAction,
  type ActionState,
} from '../channels-actions';
import type { ChannelIdentityRow } from '../channels-data';

const initial: ActionState = {};

/** Where a test message goes, per channel — the id format differs everywhere. */
const TEST_HINTS: Record<string, string> = {
  whatsapp: 'Recipient phone number in international format, e.g. +14155551234.',
  instagram: 'Instagram-scoped user id of someone who has messaged you.',
  facebook: 'Page-scoped user id (PSID) of someone who has messaged your Page.',
  email: 'Any email address.',
  telegram: 'Telegram chat id — message your bot once, then use that chat id.',
  viber: 'Viber user id of a subscriber.',
  line: 'LINE user id (starts with U). Sent as a push message.',
  tiktok: 'A comment id — TikTok only allows replying in a comment thread.',
  youtube: 'A comment id — the reply is posted in that thread.',
};

const MODE_LABELS: Array<{ value: string; label: string }> = [
  { value: 'private_with_ack', label: 'Private DM + public acknowledgement' },
  { value: 'public', label: 'Public reply in the thread' },
  { value: 'off', label: 'Do not answer comments' },
];

/**
 * The per-channel controls that only matter once a channel is connected:
 * how public comments are answered, and a real send to prove it works.
 * Collapsed by default so the list stays scannable.
 */
export function ChannelRowTools({ row }: { row: ChannelIdentityRow }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="w-full">
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide settings' : 'Settings & test'}
      </Button>
      {open ? (
        <div className="mt-3 grid gap-6 rounded-md border bg-muted/20 p-4 md:grid-cols-2">
          {row.supportsComments ? <CommentSettings row={row} /> : null}
          <TestMessage row={row} />
        </div>
      ) : null}
    </div>
  );
}

function CommentSettings({ row }: { row: ChannelIdentityRow }) {
  const [state, action] = useFormState(updateChannelCommentSettingsAction, initial);
  const [mode, setMode] = useState<string>(row.commentReply);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={row.id} />
      <p className="text-sm font-medium">Public comments</p>
      <FormField
        label="When someone comments on a post"
        htmlFor={`commentReply-${row.id}`}
        hint="A private answer keeps the public thread tidy; the acknowledgement tells other readers it was handled."
      >
        <Select name="commentReply" value={mode} onChange={(e) => setMode(e.target.value)}>
          {MODE_LABELS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
      </FormField>
      {mode === 'private_with_ack' ? (
        <FormField label="Public acknowledgement" htmlFor={`commentAck-${row.id}`}>
          <Input name="commentAck" defaultValue={row.commentAck} maxLength={500} />
        </FormField>
      ) : null}
      <FormMessage state={state} okText={state.message ?? 'Comment settings saved.'} />
      <SubmitButton size="sm">Save comment settings</SubmitButton>
    </form>
  );
}

function TestMessage({ row }: { row: ChannelIdentityRow }) {
  const [state, action] = useFormState(sendChannelTestMessageAction, initial);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={row.id} />
      <p className="text-sm font-medium">Send a test message</p>
      <FormField
        label="Send to"
        htmlFor={`to-${row.id}`}
        hint={TEST_HINTS[row.channel] ?? 'The recipient id for this channel.'}
        required
      >
        <Input name="to" required maxLength={300} />
      </FormField>
      <FormField label="Message" htmlFor={`text-${row.id}`}>
        <Input
          name="text"
          maxLength={1000}
          defaultValue="Test message from your AI assistant — this channel is connected."
        />
      </FormField>
      <FormMessage state={state} okText={state.message ?? 'Sent.'} />
      <SubmitButton size="sm" pendingLabel="Sending…">
        Send test
      </SubmitButton>
    </form>
  );
}
