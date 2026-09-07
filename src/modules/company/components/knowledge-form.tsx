'use client';

import { useFormState } from 'react-dom';
import { Alert } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Select, type SelectProps } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import {
  addFileSourceAction,
  addTextSourceAction,
  addUrlSourceAction,
  type ActionState,
} from '../knowledge-actions';

const initial: ActionState = {};

// `...rest` matters: `FormField` wires the control by cloning it with
// `aria-describedby` / `aria-invalid`, and a wrapper that swallowed its extra
// props would quietly drop that.
function BotSelect({ bots, ...rest }: SelectProps & { bots: { id: string; name: string }[] }) {
  return (
    <Select name="botId" defaultValue="" {...rest}>
      <option value="">All assistants</option>
      {bots.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </Select>
  );
}

export function KnowledgeForm({
  bots,
  uploadedFileCount = 0,
}: {
  bots: { id: string; name: string }[];
  uploadedFileCount?: number;
}) {
  const [state, action] = useFormState(addTextSourceAction, initial);
  const [urlState, urlAction] = useFormState(addUrlSourceAction, initial);
  const [fileState, fileAction] = useFormState(addFileSourceAction, initial);

  return (
    <div className="space-y-8">
      {/* `border-amber-200 bg-amber-50 text-amber-950` → `warning`, not "note":
          this is a compliance caution about what must not be uploaded, and the
          consequence of ignoring it is a data-protection breach. */}
      <Alert tone="warning" title="Before adding business data" className="p-4">
        <p className="text-xs leading-5">
          Add only information your business is allowed to use for customer replies. Do not upload
          payment card data, passwords, special category data, or unnecessary personal details.
          Review the{' '}
          <a href="/privacy" className="font-medium underline">
            Privacy Policy
          </a>{' '}
          and{' '}
          <a href="/data-processing" className="font-medium underline">
            Data Processing Notice
          </a>
          .
        </p>
      </Alert>

      <form action={fileAction} className="space-y-4 rounded-md border bg-muted/20 p-4">
        <div>
          <h3 className="font-medium">Upload a small knowledge file</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            PDF, DOCX, TXT, Markdown, or CSV. Local text extraction first; only cleaned text is
            indexed. Limit 3 files, 5 MB each, PDF max 10 pages.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {uploadedFileCount}/3 uploaded files used.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="File" htmlFor="file">
            <Input
              name="file"
              type="file"
              accept=".pdf,.docx,.txt,.md,.csv,text/*,application/pdf"
            />
          </FormField>
          <FormField label="Assistant" htmlFor="fileBotId">
            <BotSelect id="fileBotId" bots={bots} />
          </FormField>
        </div>
        <FormMessage state={fileState} okText="File extracted and indexed." />
        <SubmitButton pendingLabel="Extracting...">Upload and index file</SubmitButton>
      </form>

      <form action={urlAction} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Website page URL" htmlFor="url">
            <Input name="url" type="url" placeholder="https://example.com/faq" />
          </FormField>
          <FormField label="Title" htmlFor="urlTitle">
            <Input name="title" placeholder="FAQ page" />
          </FormField>
          <FormField label="Assistant" htmlFor="urlBotId">
            <BotSelect id="urlBotId" bots={bots} />
          </FormField>
        </div>
        <FormMessage state={urlState} okText="Imported and indexed." />
        <SubmitButton pendingLabel="Importing...">Import page</SubmitButton>
      </form>

      <form action={action} className="space-y-4 border-t pt-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Title" htmlFor="title" required>
            <Input name="title" required placeholder="e.g. Refund policy" />
          </FormField>
          <FormField label="Assistant" htmlFor="botId">
            <BotSelect id="botId" bots={bots} />
          </FormField>
        </div>
        <FormField label="Content" htmlFor="text" required>
          <Textarea
            name="text"
            rows={8}
            required
            placeholder="Paste the text you want your assistant to learn from..."
          />
        </FormField>
        <FormMessage state={state} okText="Added. Your assistant can now use this." />
        <SubmitButton pendingLabel="Adding...">Add to knowledge base</SubmitButton>
      </form>
    </div>
  );
}
