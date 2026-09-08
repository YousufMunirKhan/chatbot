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
  const panelId = `channel-tools-${row.id}`;
  const name = row.displayName ?? row.channelLabel;
  return (
    <div className="w-full">
      {/*
        A button that shows and hides a panel has to SAY so. Without
        `aria-expanded` a screen-reader user hears "Settings & test, button",
        presses it, and is told nothing at all — the panel appears below the
        focus point and there is no announcement that anything happened.
        `aria-controls` names what it opened; the label names which connected
        account it belongs to, because a page with six channels otherwise
        offers six buttons all called "Settings & test".
      */}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
      >
        {open ? 'Hide settings' : 'Settings & test'}
        <span className="sr-only"> for {name}</span>
      </Button>
      {/*
        `md:grid-cols-2` was a VIEWPORT query on a panel nested three boxes
        deep: page padding, then a `max-w-6xl` card, then a list row. At 768px
        — exactly where the rule switches on — the dashboard sidebar is already
        showing, so the row is about 450px and each of these two columns was
        ~210px holding a `<select>` whose longest option is "Private DM + public
        acknowledgement". A native select cannot truncate; it cut its own text
        off mid-word. The floor asks the row how much room there really is, and
        gives the two forms one column each only when both can be used.
      */}
      {open ? (
        <div
          id={panelId}
          className="mt-3 grid gap-6 rounded-md border bg-muted/20 p-4 [grid-template-columns:repeat(auto-fit,minmax(18rem,1fr))]"
        >
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
      {/*
        `<p className="text-sm font-medium">` looked like a heading and was not
        one — it named this group of controls to a sighted reader and to nobody
        else. A `<legend>` gives the group a real accessible name, which is what
        a run of related fields wants; a heading would be wrong here anyway,
        because the same two words repeat once per connected channel and a
        screen-reader user navigating by heading would land on six identical
        "Public comments" with nothing to tell them apart.
      */}
      <fieldset className="space-y-3">
        <legend className="mb-3 text-sm font-medium">
          Public comments
          <span className="sr-only"> on {row.displayName ?? row.channelLabel}</span>
        </legend>
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
          <FormField
            label="Public acknowledgement"
            htmlFor={`commentAck-${row.id}`}
            hint="The one line posted in the open thread while the real answer goes by private message."
          >
            <Input name="commentAck" defaultValue={row.commentAck} maxLength={500} />
          </FormField>
        ) : null}
      </fieldset>
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
      <fieldset className="space-y-3">
        <legend className="mb-3 text-sm font-medium">
          Send a test message
          <span className="sr-only"> from {row.displayName ?? row.channelLabel}</span>
        </legend>
        <FormField
          label="Send to"
          htmlFor={`to-${row.id}`}
          hint={TEST_HINTS[row.channel] ?? 'The recipient id for this channel.'}
          required
        >
          <Input name="to" required maxLength={300} />
        </FormField>
        <FormField
          label="Message"
          htmlFor={`text-${row.id}`}
          hint="This really is sent, and it really is charged. Send it to your own number."
        >
          <Input
            name="text"
            maxLength={1000}
            defaultValue="Test message from your AI assistant — this channel is connected."
          />
        </FormField>
      </fieldset>
      <FormMessage state={state} okText={state.message ?? 'Sent.'} />
      <SubmitButton size="sm" pendingLabel="Sending…">
        Send test
      </SubmitButton>
    </form>
  );
}
