'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  addFileSourceAction,
  addTextSourceAction,
  addUrlSourceAction,
  type ActionState,
} from '../knowledge-actions';

const initial: ActionState = {};
const selectCls =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function Submit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

function BotSelect({ bots, id }: { bots: { id: string; name: string }[]; id: string }) {
  return (
    <select id={id} name="botId" className={selectCls} defaultValue="">
      <option value="">All assistants</option>
      {bots.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </select>
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
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <p className="font-medium">Before adding business data</p>
        <p className="mt-1 text-xs leading-5">
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
      </div>

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
          <div className="space-y-1.5">
            <Label htmlFor="file">File</Label>
            <Input
              id="file"
              name="file"
              type="file"
              accept=".pdf,.docx,.txt,.md,.csv,text/*,application/pdf"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fileBotId">Assistant</Label>
            <BotSelect id="fileBotId" bots={bots} />
          </div>
        </div>
        {fileState.error ? <p className="text-sm text-destructive">{fileState.error}</p> : null}
        {fileState.ok ? (
          <p className="text-sm text-emerald-600">File extracted and indexed.</p>
        ) : null}
        <Submit label="Upload and index file" pendingLabel="Extracting..." />
      </form>

      <form action={urlAction} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="url">Website page URL</Label>
            <Input id="url" name="url" type="url" placeholder="https://example.com/faq" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="urlTitle">Title</Label>
            <Input id="urlTitle" name="title" placeholder="FAQ page" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="urlBotId">Assistant</Label>
            <BotSelect id="urlBotId" bots={bots} />
          </div>
        </div>
        {urlState.error ? <p className="text-sm text-destructive">{urlState.error}</p> : null}
        {urlState.ok ? <p className="text-sm text-emerald-600">Imported and indexed.</p> : null}
        <Submit label="Import page" pendingLabel="Importing..." />
      </form>

      <form action={action} className="space-y-4 border-t pt-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="title">Title *</Label>
            <Input id="title" name="title" required placeholder="e.g. Refund policy" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="botId">Assistant</Label>
            <BotSelect id="botId" bots={bots} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="text">Content *</Label>
          <Textarea
            id="text"
            name="text"
            rows={8}
            required
            placeholder="Paste the text you want your assistant to learn from..."
          />
        </div>
        {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
        {state.ok ? (
          <p className="text-sm text-emerald-600">Added. Your assistant can now use this.</p>
        ) : null}
        <Submit label="Add to knowledge base" pendingLabel="Adding..." />
      </form>
    </div>
  );
}
