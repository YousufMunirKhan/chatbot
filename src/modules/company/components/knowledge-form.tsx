'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFormState } from 'react-dom';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Select, type SelectProps } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { FIELD_GRID, FORM_SECTION_TITLE } from './form-layout';
import {
  KNOWLEDGE_UPLOAD_ACCEPT,
  MAX_CRAWL_PAGES,
  MAX_KNOWLEDGE_FILE_BYTES,
  MAX_KNOWLEDGE_PDF_PAGES,
  MAX_PASTED_TEXT_CHARS,
  MAX_UPLOADED_KNOWLEDGE_FILES,
  approximatePages,
  formatBytes,
} from '@/lib/knowledge/limits';
import {
  addTextSourceAction,
  addUrlSourceAction,
  type ActionState,
} from '../knowledge-actions';
import { KnowledgeStatusPanel } from './knowledge-status-panel';

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

/**
 * The result of an add, beyond pass/fail.
 *
 * `FormMessage` renders one line and only knows `ok` / `error`, which is the
 * right shape for "Saved." and the wrong shape for "we indexed the first 250 of
 * your 400 pages". A truncation or a queued job is not an error — the document
 * was added — so it gets its own block underneath rather than being squeezed
 * into the success line or, as before, not being said at all.
 */
function ResultNotice({ state }: { state: ActionState }) {
  if (!state.ok || !state.notice) return null;
  return (
    <Alert tone={state.queued ? 'info' : 'warning'} role="status" aria-live="polite">
      <p className="text-xs leading-5">{state.notice}</p>
    </Alert>
  );
}

interface UploadResult {
  title: string;
  queued: boolean;
  truncationReason: string | null;
  pageCount: number | null;
  pagesIngested: number | null;
}

/**
 * File upload, posted to `/api/company/knowledge/upload` rather than through a
 * server action.
 *
 * This is not a style preference. Next caps a server action's request body at
 * 1 MB unless `experimental.serverActions.bodySizeLimit` is configured, and it
 * is not — so the "5 MB" the old copy advertised was unreachable and every real
 * PDF failed in the framework with an error nobody could act on. A route
 * handler has no such cap.
 *
 * Going through XHR rather than `fetch` buys the one thing `fetch` still cannot
 * give a browser: `upload.onprogress`. A 20 MB file on a shop's broadband is
 * thirty seconds of nothing, and a determinate bar is the difference between
 * waiting and giving up.
 */
function FileUploadForm({ bots }: { bots: { id: string; name: string }[] }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);

  const submit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      const file = data.get('file');
      if (!(file instanceof File) || file.size === 0) {
        setError('Choose a file to upload.');
        return;
      }
      if (file.size > MAX_KNOWLEDGE_FILE_BYTES) {
        setError(
          `That file is ${formatBytes(file.size)}. Uploads are limited to ${formatBytes(MAX_KNOWLEDGE_FILE_BYTES)}.`,
        );
        return;
      }

      setError(null);
      setResult(null);
      setPercent(0);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/company/knowledge/upload');
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setPercent(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        setPercent(null);
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(xhr.responseText) as Record<string, unknown>;
        } catch {
          body = {};
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          setResult(body as unknown as UploadResult);
          formRef.current?.reset();
          // The document list is server-rendered above this form.
          router.refresh();
          return;
        }
        const apiError = body.error as { message?: string } | undefined;
        setError(apiError?.message ?? 'The upload failed. Try again.');
      };
      xhr.onerror = () => {
        setPercent(null);
        setError('The upload did not reach the server. Check your connection and try again.');
      };
      xhr.send(data);
    },
    [router],
  );

  const busy = percent !== null;

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      className="space-y-4 rounded-md border bg-muted/20 p-4"
      noValidate
    >
      <div>
        <h3 className={FORM_SECTION_TITLE}>Upload a file</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          PDF, DOCX, TXT, Markdown, or CSV, up to {formatBytes(MAX_KNOWLEDGE_FILE_BYTES)} and{' '}
          {MAX_KNOWLEDGE_PDF_PAGES} PDF pages each. Text is extracted here and only the cleaned text
          is indexed. If a file is longer than we index, we say so instead of shortening it quietly.
        </p>
      </div>
      <div className={FIELD_GRID}>
        <FormField label="File" htmlFor="file">
          <Input id="file" name="file" type="file" accept={KNOWLEDGE_UPLOAD_ACCEPT} disabled={busy} />
        </FormField>
        <FormField label="Assistant" htmlFor="fileBotId">
          <BotSelect id="fileBotId" bots={bots} disabled={busy} />
        </FormField>
      </div>

      {busy ? (
        <div>
          <p className="text-xs text-muted-foreground">
            {percent! < 100 ? `Uploading ${percent}%` : 'Reading the file…'}
          </p>
          <Progress className="mt-2" value={percent ?? 0} label="File upload progress" />
        </div>
      ) : null}

      <p role={error ? 'alert' : 'status'} aria-live={error ? undefined : 'polite'} className="text-sm empty:hidden">
        {error ? <span className="text-danger-fg">{error}</span> : null}
        {result && !error ? (
          <span className="text-success-fg">
            {result.queued
              ? `${result.title} was uploaded and is being indexed.`
              : `${result.title} was uploaded and indexed.`}
          </span>
        ) : null}
      </p>

      {result?.truncationReason ? (
        <Alert tone="warning" role="status" title="Not all of that file was indexed">
          <p className="text-xs leading-5">{result.truncationReason}</p>
        </Alert>
      ) : null}

      <Button type="submit" disabled={busy} aria-busy={busy}>
        {busy ? 'Uploading…' : 'Upload this file'}
      </Button>
    </form>
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

      <KnowledgeStatusPanel />

      <div className="space-y-2">
        <FileUploadForm bots={bots} />
        <p className="text-xs text-muted-foreground">
          {uploadedFileCount} of {MAX_UPLOADED_KNOWLEDGE_FILES} uploaded files used.
        </p>
      </div>

      <form action={urlAction} className="space-y-4">
        <div>
          <h3 className={FORM_SECTION_TITLE}>Import one web page</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            One page, kept as its own document. Importing the same address again updates that
            document instead of adding a second copy of it. To read a whole site, use the website
            import — it reads up to {MAX_CRAWL_PAGES} pages.
          </p>
        </div>
        <div className={FIELD_GRID}>
          <FormField label="Website page URL" htmlFor="url">
            <Input id="url" name="url" type="url" placeholder="https://example.com/faq" />
          </FormField>
          <FormField label="Title" htmlFor="urlTitle">
            <Input id="urlTitle" name="title" placeholder="FAQ page" />
          </FormField>
          <FormField label="Assistant" htmlFor="urlBotId">
            <BotSelect id="urlBotId" bots={bots} />
          </FormField>
        </div>
        <FormMessage state={urlState} okText="Imported and indexed." />
        <ResultNotice state={urlState} />
        <SubmitButton pendingLabel="Importing…">Import page</SubmitButton>
      </form>

      <form action={action} className="space-y-4 border-t pt-6">
        {/* The only one of the three ways to add knowledge that had no heading
            at all — it began with a bare "Title" box under a horizontal rule,
            so it read as more of the web-page import above it. */}
        <div>
          <h3 className={FORM_SECTION_TITLE}>Type or paste it in</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            For a policy or an answer you have not written down anywhere else. It becomes its own
            document, exactly as you type it.
          </p>
        </div>
        <div className={FIELD_GRID}>
          <FormField label="Title" htmlFor="title" required>
            <Input id="title" name="title" required placeholder="e.g. Refund policy" />
          </FormField>
          <FormField label="Assistant" htmlFor="botId">
            <BotSelect id="botId" bots={bots} />
          </FormField>
        </div>
        <FormField
          label="Content"
          htmlFor="text"
          required
          hint={`Up to ${MAX_PASTED_TEXT_CHARS.toLocaleString()} characters — about ${approximatePages(MAX_PASTED_TEXT_CHARS)} pages. Longer than that, upload it as a file instead.`}
        >
          <Textarea
            id="text"
            name="text"
            rows={8}
            required
            placeholder="Paste the text you want your assistant to learn from..."
          />
        </FormField>
        <FormMessage state={state} okText="Added. Your assistant can now use this." />
        <ResultNotice state={state} />
        <SubmitButton pendingLabel="Adding…">Add to knowledge base</SubmitButton>
      </form>
    </div>
  );
}
