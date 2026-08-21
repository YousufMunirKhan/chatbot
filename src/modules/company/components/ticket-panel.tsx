'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  addInternalNoteAction,
  resolveTicketAction,
  setPriorityAction,
  updateTagsAction,
  type ActionState,
} from '../inbox-actions';
import type { InternalNote } from '../inbox-data';

const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
const initial: ActionState = {};
const RESOLUTION_TEMPLATES = [
  {
    label: 'Fixed',
    body: 'Fixed. The issue has been checked and the affected workflow is working again.',
  },
  {
    label: 'Needs connector update',
    body: 'Needs connector update. The platform is ready, but the customer connector must be updated or restarted before this works reliably.',
  },
  {
    label: 'User permissions issue',
    body: 'User permissions issue. The staff member needs the correct POS/app permission before this action can be completed.',
  },
  {
    label: 'External POS API down',
    body: 'External POS API down. The request reached the connector, but the POS/API dependency is currently unavailable.',
  },
] as const;

function NoteSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Saving…' : 'Add note'}
    </Button>
  );
}

function ResolveSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Resolving...' : 'Resolve ticket'}
    </Button>
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
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">Priority</p>
        <div className="flex flex-wrap gap-1.5">
          {PRIORITIES.map((p) => (
            <Button
              key={p}
              type="button"
              size="sm"
              variant={priority === p ? 'default' : 'outline'}
              disabled={isPending}
              onClick={() => setPriority(p)}
              className="capitalize"
            >
              {p}
            </Button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">Tags</p>
        {tags.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <Badge key={t} variant="secondary">{t}</Badge>
            ))}
          </div>
        ) : (
          <p className="mb-2 text-xs text-muted-foreground">No tags on this ticket yet.</p>
        )}
        <div className="flex gap-2">
          <Input
            value={tagsValue}
            onChange={(e) => setTagsValue(e.target.value)}
            placeholder="vip, refund, billing"
          />
          <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={saveTags}>
            Save
          </Button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Comma-separated. Used for filtering and reporting.</p>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Resolution
        </p>
        <form action={resolveAction} className="space-y-2 rounded-md border bg-emerald-50/50 p-3">
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
          <Textarea
            name="resolution"
            rows={3}
            required
            maxLength={2000}
            value={resolution}
            onChange={(event) => setResolution(event.target.value)}
            placeholder="What was fixed? This message is saved on the ticket and can be emailed to the reporter."
          />
          {resolveState.error ? <p className="text-sm text-destructive">{resolveState.error}</p> : null}
          {resolveState.ok ? <p className="text-sm text-emerald-700">Resolved. Automations were triggered.</p> : null}
          <ResolveSubmit />
        </form>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Internal notes
        </p>
        <p className="mb-2 text-xs text-muted-foreground">Private to your team — the visitor never sees these.</p>
        {notes.length > 0 ? (
          <ul className="mb-3 space-y-2">
            {notes.map((n) => (
              <li key={n.id} className="rounded-md border bg-amber-50/60 p-2 text-sm">
                <p className="whitespace-pre-wrap">{n.note}</p>
                <p className="mt-1 text-xs text-muted-foreground">{n.author}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-3 rounded-md border border-dashed p-2 text-xs text-muted-foreground">
            No notes yet. Add what you tried or who you called, so whoever picks this up next has the context.
          </p>
        )}
        <form action={noteAction} className="space-y-2">
          <input type="hidden" name="conversationId" value={conversationId} />
          <Textarea name="note" rows={2} required maxLength={4000} placeholder="Add an internal note…" />
          {noteState.error ? <p className="text-sm text-destructive">{noteState.error}</p> : null}
          <NoteSubmit />
        </form>
      </div>
    </div>
  );
}
