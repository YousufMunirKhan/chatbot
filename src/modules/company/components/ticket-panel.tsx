'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useFormState } from 'react-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import { Textarea } from '@/components/ui/textarea';
import { PRIORITY_LABELS, labelFor } from '@/lib/constants';
import {
  addInternalNoteAction,
  resolveTicketAction,
  setPriorityAction,
  updateTagsAction,
  type ActionState,
} from '../inbox-actions';
import type { InternalNote } from '../inbox-data';

/**
 * Values only. The wording lives in `PRIORITY_LABELS`, because a second copy
 * here is how the same stored value ends up reading two different ways on two
 * screens.
 */
const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
const initial: ActionState = {};
/**
 * Written for the person reading the reply, not for the engineer writing it.
 * The old set opened with lines like "Needs connector update. The platform is
 * ready, but the customer connector must be updated or restarted" — three
 * nouns a shop owner has never met.
 */
const RESOLUTION_TEMPLATES = [
  {
    label: 'Sorted it',
    body: 'We looked into this and it is working again now. Let us know if you see it happen a second time.',
  },
  {
    label: 'Update needed on the till',
    body: 'Everything is ready on our side. The app on your till needs updating or restarting, and then this will work as expected.',
  },
  {
    label: 'Staff member needs access',
    body: 'The member of staff who tried this does not have permission for it yet. Once someone with admin access turns that on for them, they can do it themselves.',
  },
  {
    label: 'Your till system was down',
    body: 'The request reached your till system, but it was not responding at the time. Nothing was lost, and this will work once that service is back.',
  },
] as const;

function NoteSubmit() {
  return (
    <SubmitButton size="sm" pendingLabel="Saving…">
      Add note
    </SubmitButton>
  );
}

function ResolveSubmit() {
  return (
    <SubmitButton size="sm" pendingLabel="Saving…">
      Mark as sorted
    </SubmitButton>
  );
}

export function TicketPanel({
  conversationId,
  priority,
  tags,
  notes,
}: {
  conversationId: string;
  priority: string;
  tags: string[];
  notes: InternalNote[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [tagsValue, setTagsValue] = useState(tags.join(', '));
  const [resolution, setResolution] = useState('');
  const [noteState, noteAction] = useFormState(addInternalNoteAction, initial);
  const [resolveState, resolveAction] = useFormState(resolveTicketAction, initial);

  function setPriority(value: string) {
    const fd = new FormData();
    fd.set('conversationId', conversationId);
    fd.set('priority', value);
    startTransition(async () => {
      await setPriorityAction(fd);
      router.refresh();
    });
  }

  function saveTags() {
    const fd = new FormData();
    fd.set('conversationId', conversationId);
    fd.set('tags', tagsValue);
    startTransition(async () => {
      await updateTagsAction(fd);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Priority
        </p>
        <div className="flex flex-wrap gap-1.5">
          {PRIORITIES.map((p) => (
            <Button
              key={p}
              type="button"
              size="sm"
              variant={priority === p ? 'default' : 'outline'}
              disabled={isPending}
              onClick={() => setPriority(p)}
            >
              {labelFor(PRIORITY_LABELS, p)}
            </Button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Tags
        </p>
        {tags.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <Badge key={t} variant="secondary">
                {t}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="mb-2 text-xs text-muted-foreground">No tags on this ticket yet.</p>
        )}
        <FormField
          label="Add or edit tags"
          htmlFor={`tags-${conversationId}`}
          hint="Your own words for grouping chats — separate them with commas. You can filter the inbox and your reports by them afterwards."
        >
          <Input
            name="tags"
            value={tagsValue}
            onChange={(e) => setTagsValue(e.target.value)}
            placeholder="vip, refund, billing"
          />
        </FormField>
        {/* Below the hint rather than beside the input: the hint explains the
            comma rule, and the button should follow what it is confirming. */}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-2"
          disabled={isPending}
          onClick={saveTags}
        >
          Save tags
        </Button>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          How it was sorted
        </p>
        {/* `bg-emerald-50/50` — a raw palette green at 50% over whatever is
            behind it, undefined in dark mode. `--success-bg` is the tinted
            surface for exactly this, defined in both themes and paired with a
            border that is contrast-checked against it. */}
        <form
          action={resolveAction}
          className="space-y-2 rounded-md border border-success-border bg-success-bg p-3"
        >
          <input type="hidden" name="conversationId" value={conversationId} />
          <div className="flex flex-wrap gap-1.5">
            {RESOLUTION_TEMPLATES.map((template) => (
              <Button
                key={template.label}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setResolution(template.body)}
              >
                {template.label}
              </Button>
            ))}
          </div>
          <FormField
            label="What you did to sort it"
            htmlFor={`resolution-${conversationId}`}
            required
            hint="Saved on the ticket, and it can be emailed to whoever reported it — so write it for them, not for your notes."
          >
            <Textarea
              name="resolution"
              rows={3}
              required
              maxLength={2000}
              value={resolution}
              onChange={(event) => setResolution(event.target.value)}
              placeholder="We looked into this and…"
            />
          </FormField>
          <FormMessage state={resolveState} okText="Sorted. Anyone following this has been told." />
          <ResolveSubmit />
        </form>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Internal notes
        </p>
        <p className="mb-2 text-xs text-muted-foreground">
          Private to your team — the visitor never sees these.
        </p>
        {notes.length > 0 ? (
          <ul className="mb-3 space-y-2">
            {notes.map((n) => (
              // `bg-amber-50/60` read as a warning and was not one — an internal
              // note is a note. `bg-muted` is the neutral inset surface, and it
              // exists in dark mode.
              <li key={n.id} className="rounded-md border bg-muted p-2 text-sm">
                <p className="whitespace-pre-wrap">{n.note}</p>
                <p className="mt-1 text-xs text-muted-foreground">{n.author}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-3 rounded-md border border-dashed p-2 text-xs text-muted-foreground">
            No notes yet. Add what you tried or who you called, so whoever picks this up next has
            the context.
          </p>
        )}
        <form action={noteAction} className="space-y-2">
          <input type="hidden" name="conversationId" value={conversationId} />
          <FormField label="Add a note for your team" htmlFor={`note-${conversationId}`} required>
            <Textarea
              name="note"
              rows={2}
              required
              maxLength={4000}
              placeholder="What you tried, or who you called…"
            />
          </FormField>
          {/* `text-destructive` is the SOLID red meant for a filled button's
              background pair, not for body text on a card — `--danger-fg` is
              the one contrast-checked for reading. And this needed the live
              region: it is the result of pressing Add note. */}
          <FormMessage state={noteState} okText="Note added." />
          <NoteSubmit />
        </form>
      </div>
    </div>
  );
}
