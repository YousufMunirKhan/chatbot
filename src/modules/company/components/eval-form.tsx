'use client';

import { useFormState } from 'react-dom';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { addEvalQuestionAction, type ActionState } from '../eval-actions';

const initial: ActionState = {};

export function EvalForm({ bots }: { bots: { id: string; name: string }[] }) {
  const [state, action] = useFormState(addEvalQuestionAction, initial);

  return (
    <form action={action} className="space-y-4">
      <FormField label="Question" htmlFor="question" required>
        <Textarea
          name="question"
          required
          minLength={3}
          placeholder="What are your business hours?"
        />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Assistant" htmlFor="botId">
          <Select name="botId" defaultValue="">
            <option value="">All assistants</option>
            {bots.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Language" htmlFor="language">
          <Select name="language" defaultValue="en">
            <option value="en">English</option>
            <option value="ar">Arabic</option>
          </Select>
        </FormField>
        <FormField label="Expected source" htmlFor="expectedSource">
          <Input name="expectedSource" placeholder="e.g. FAQ document" />
        </FormField>
      </div>
      <div className="flex items-center gap-2">
        {/* Checkbox-then-label rows are not `FormField` (which puts the label
            above the control); they keep the repo's one checkbox class. */}
        <input id="mustNotAnswer" name="mustNotAnswer" type="checkbox" className="h-4 w-4" />
        <Label htmlFor="mustNotAnswer" className="font-normal">
          Must not answer if no context is found
        </Label>
      </div>
      <FormMessage state={state} okText="Question added." />
      <SubmitButton pendingLabel="Adding…">Add question</SubmitButton>
    </form>
  );
}
