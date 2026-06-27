'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { addEvalQuestionAction, type ActionState } from '../eval-actions';

const initial: ActionState = {};
const selectCls =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function Save() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Adding…' : 'Add question'}
    </Button>
  );
}

export function EvalForm({ bots }: { bots: { id: string; name: string }[] }) {
  const [state, action] = useFormState(addEvalQuestionAction, initial);

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="question">Question *</Label>
        <Textarea id="question" name="question" required minLength={3} placeholder="What are your business hours?" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="botId">Assistant</Label>
          <select id="botId" name="botId" className={selectCls} defaultValue="">
            <option value="">All assistants</option>
            {bots.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="language">Language</Label>
          <select id="language" name="language" className={selectCls} defaultValue="en">
            <option value="en">English</option>
            <option value="ar">Arabic</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="expectedSource">Expected source</Label>
          <Input id="expectedSource" name="expectedSource" placeholder="e.g. FAQ document" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          id="mustNotAnswer"
          name="mustNotAnswer"
          type="checkbox"
          className="h-4 w-4 rounded border-input"
        />
        <Label htmlFor="mustNotAnswer" className="font-normal">
          Must not answer if no context is found
        </Label>
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-emerald-600">Question added.</p> : null}
      <Save />
    </form>
  );
}
