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
  setPriorityAction,
  updateTagsAction,
  type ActionState,
} from '../inbox-actions';
import type { InternalNote } from '../inbox-data';

const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
const initial: ActionState = {};

function NoteSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Saving…' : 'Add note'}
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
  const [noteState, noteAction] = useFormState(addInternalNoteAction, initial);

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
        ) : null}
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
        ) : null}
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
