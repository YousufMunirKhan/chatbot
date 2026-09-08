'use client';

import { useFormState } from 'react-dom';
import { Alert } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { FIELD_GRID } from './form-layout';
import { MAX_KNOWLEDGE_DOC_CHARS, approximatePages } from '@/lib/knowledge/limits';
import { updateDocumentAction, type ActionState } from '../knowledge-actions';

const initial: ActionState = {};

/**
 * Edit the text of one knowledge document.
 *
 * Deliberately the same three fields as the "add text" half of
 * `knowledge-form.tsx`, in the same order: an owner who pasted this in should
 * recognise the form they pasted it into. The difference is what it costs to
 * submit — every save rebuilds this document's embeddings, which is why the
 * copy under the button says so rather than leaving the owner to wonder whether
 * the assistant has caught up.
 *
 * The textarea is uncontrolled (`defaultValue`). A 200,000-character document
 * re-rendered on every keystroke is a typing lag the owner can feel, and there
 * is nothing here that needs to react to the text as it is typed.
 */
export function KnowledgeDocumentForm({
  doc,
  bots,
}: {
  doc: { id: string; title: string; text: string; botId: string | null };
  bots: { id: string; name: string }[];
}) {
  const [state, action] = useFormState(updateDocumentAction, initial);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="documentId" value={doc.id} />

      <div className={FIELD_GRID}>
        <FormField label="Title" htmlFor="documentTitle" required>
          <Input id="documentTitle" name="title" required defaultValue={doc.title} />
        </FormField>
        <FormField label="Assistant" htmlFor="documentBotId">
          <Select id="documentBotId" name="botId" defaultValue={doc.botId ?? ''}>
            <option value="">All assistants</option>
            {bots.map((bot) => (
              <option key={bot.id} value={bot.id}>
                {bot.name}
              </option>
            ))}
          </Select>
        </FormField>
      </div>

      <FormField
        label="Content"
        htmlFor="documentText"
        required
        hint={`Up to ${MAX_KNOWLEDGE_DOC_CHARS.toLocaleString()} characters — about ${approximatePages(MAX_KNOWLEDGE_DOC_CHARS)} pages. Saving replaces what your assistant learned from this document.`}
      >
        <Textarea id="documentText" name="text" rows={18} required defaultValue={doc.text} />
      </FormField>

      <FormMessage state={state} okText="Saved and re-indexed. Your assistant is using the new wording." />

      {state.ok && state.notice ? (
        <Alert tone="info" role="status" aria-live="polite">
          <p className="text-xs leading-5">{state.notice}</p>
        </Alert>
      ) : null}

      <SubmitButton pendingLabel="Saving and re-indexing…">Save and re-index</SubmitButton>
    </form>
  );
}
