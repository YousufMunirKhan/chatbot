'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFormState } from 'react-dom';
import { Alert } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { SubmitButton } from '@/components/ui/submit-button';
import { formatNumber } from '@/lib/format';
import { recrawlWebsiteAction, type ActionState } from '../knowledge-actions';

/**
 * What is happening to the knowledge base right now.
 *
 * Ingestion moved onto the `background_jobs` queue, which is the only way a
 * 60-page PDF or a 60-page website crawl can finish at all — but a queue with
 * no visible progress is worse than a slow request, because the admin has no
 * idea whether anything is happening. So this polls the status endpoint and
 * shows the real numbers the job writes as it goes: which document, which
 * batch, how many pages of the site.
 *
 * It also does the telling-the-truth half. A document whose source was longer
 * than we index carries `truncationReason` — "This PDF has 84 pages and we read
 * the first 250" — and that sentence appears here and stays on the document
 * row, instead of the green tick the old code showed for a file it had thrown
 * five sixths of away.
 *
 * The response shape is declared locally rather than imported from
 * `knowledge-data.ts`: this is a client component and that module reaches the
 * database. What crosses the wire is JSON, so this is also the honest type for
 * it.
 */

interface StatusDocument {
  id: string;
  title: string;
  status: string;
  charCount: number;
  sourceUrl: string | null;
  truncated: boolean;
  truncationReason: string | null;
  pageCount: number | null;
  pagesIngested: number | null;
  ingestProgress: number;
  ingestStage: string | null;
}

interface StatusCrawl {
  id: string;
  rootUrl: string;
  status: string;
  discovery: string;
  pagesDiscovered: number;
  pagesIngested: number;
  pagesFailed: number;
  pagesSkipped: number;
  pageLimit: number;
  errorMessage: string | null;
}

interface KnowledgeStatusResponse {
  documents: StatusDocument[];
  crawls: StatusCrawl[];
  totalDocuments: number;
  totalChars: number;
  charLimit: number;
  documentLimit: number;
  busy: boolean;
}

const POLL_MS = 2_500;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function RecrawlButton({ crawlId }: { crawlId: string }) {
  const [state, action] = useFormState(recrawlWebsiteAction, {} as ActionState);
  return (
    <form action={action} className="mt-2 flex items-center gap-3">
      <input type="hidden" name="crawlId" value={crawlId} />
      <SubmitButton size="sm" variant="outline" pendingLabel="Queueing…">
        Refresh this site
      </SubmitButton>
      {state.error ? <span className="text-xs text-danger-fg">{state.error}</span> : null}
      {state.ok ? <span className="text-xs text-success-fg">{state.notice ?? 'Queued.'}</span> : null}
    </form>
  );
}

export function KnowledgeStatusPanel() {
  const router = useRouter();
  const [status, setStatus] = useState<KnowledgeStatusResponse | null>(null);
  const draining = useRef(false);
  const wasBusy = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/company/knowledge/status', { cache: 'no-store' });
      if (!res.ok) return;
      setStatus((await res.json()) as KnowledgeStatusResponse);
    } catch {
      // A dropped poll is not worth showing an error for; the next tick retries.
    }
  }, []);

  // Nudge the queue while somebody is watching. `/api/cron?task=jobs` drains the
  // same jobs every five minutes regardless, so this only changes how long the
  // admin waits — never whether the work happens. It is deliberately not
  // awaited by the poll loop: draining a big document takes far longer than a
  // poll interval, and blocking on it would freeze the progress bar it feeds.
  const drain = useCallback(async () => {
    if (draining.current) return;
    draining.current = true;
    try {
      await fetch('/api/company/knowledge/status', { method: 'POST' });
      await load();
    } catch {
      /* the cron drain remains the backstop */
    } finally {
      draining.current = false;
    }
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!status) return;

    if (status.busy) {
      wasBusy.current = true;
      void drain();
      const timer = setTimeout(() => void load(), POLL_MS);
      return () => clearTimeout(timer);
    }

    // Work just finished: the server-rendered document table above is now stale.
    if (wasBusy.current) {
      wasBusy.current = false;
      router.refresh();
    }
    return undefined;
  }, [status, drain, load, router]);

  if (!status) return null;

  const active = status.documents.filter((d) => d.status === 'pending' || d.status === 'processing');
  const failed = status.documents.filter((d) => d.status === 'failed');
  const truncated = status.documents.filter((d) => d.truncated && d.status === 'ready');
  const liveCrawls = status.crawls.filter((c) => c.status === 'queued' || c.status === 'running');
  const finishedCrawls = status.crawls.filter(
    (c) => (c.status === 'completed' || c.status === 'partial') && (c.pagesSkipped > 0 || c.pagesFailed > 0),
  );
  const usedPercent = status.charLimit > 0 ? (status.totalChars / status.charLimit) * 100 : 0;

  const nothingToSay =
    active.length === 0 &&
    failed.length === 0 &&
    truncated.length === 0 &&
    liveCrawls.length === 0 &&
    finishedCrawls.length === 0 &&
    usedPercent < 80;
  if (nothingToSay) return null;

  return (
    <div className="space-y-3" aria-live="polite">
      {liveCrawls.map((crawl) => {
        // A link crawl only learns its own size as it goes, so `pagesDiscovered`
        // starts at 1 and climbs. Never let the target fall below what has
        // already been read, or the bar reads "12 of 1 pages".
        const target = Math.max(
          crawl.pagesIngested,
          Math.min(crawl.pagesDiscovered || crawl.pageLimit, crawl.pageLimit),
          1,
        );
        return (
          <div key={crawl.id} className="rounded-md border bg-muted/20 p-3">
            <p className="text-sm font-medium">Reading {hostOf(crawl.rootUrl)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {crawl.pagesIngested} of {target} pages indexed
              {crawl.discovery === 'sitemap'
                ? ' — found from the site’s sitemap'
                : ' — found by following links'}
              {crawl.pagesFailed > 0 ? ` · ${crawl.pagesFailed} could not be read` : ''}
            </p>
            <Progress
              className="mt-2"
              value={(crawl.pagesIngested / target) * 100}
              label={`Website import progress for ${hostOf(crawl.rootUrl)}`}
            />
          </div>
        );
      })}

      {active.map((doc) => (
        <div key={doc.id} className="rounded-md border bg-muted/20 p-3">
          <p className="truncate text-sm font-medium">{doc.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {doc.ingestStage ?? 'Waiting to be indexed'} · {formatNumber(doc.charCount)} characters
          </p>
          <Progress
            className="mt-2"
            value={doc.ingestProgress}
            label={`Indexing progress for ${doc.title}`}
          />
        </div>
      ))}

      {truncated.map((doc) => (
        <Alert key={doc.id} tone="warning" title={`${doc.title} was shortened`}>
          <p className="text-xs leading-5">
            {doc.truncationReason ??
              'Part of this document was not indexed because it is longer than we index.'}
          </p>
          {doc.pageCount != null && doc.pagesIngested != null ? (
            <p className="mt-1 text-xs">
              Indexed {formatNumber(doc.pagesIngested)} of {formatNumber(doc.pageCount)} pages.
            </p>
          ) : null}
        </Alert>
      ))}

      {failed.map((doc) => (
        <Alert key={doc.id} tone="danger" title={`${doc.title} could not be indexed`}>
          <p className="text-xs leading-5">
            {doc.ingestStage ?? 'Something went wrong while indexing this document.'} Delete it and
            try again, or paste the content as text.
          </p>
        </Alert>
      ))}

      {finishedCrawls.map((crawl) => (
        <Alert key={crawl.id} tone={crawl.pagesSkipped > 0 ? 'warning' : 'info'} title={hostOf(crawl.rootUrl)}>
          <p className="text-xs leading-5">
            Indexed {crawl.pagesIngested} page{crawl.pagesIngested === 1 ? '' : 's'}
            {crawl.pagesSkipped > 0
              ? `. Your site has more pages than the ${crawl.pageLimit}-page import limit, so ${crawl.pagesSkipped} were not read — the most useful pages were taken first.`
              : '.'}
            {crawl.pagesFailed > 0 ? ` ${crawl.pagesFailed} page(s) could not be read.` : ''}
            {crawl.errorMessage ? ` ${crawl.errorMessage}` : ''}
          </p>
          <RecrawlButton crawlId={crawl.id} />
        </Alert>
      ))}

      {usedPercent >= 80 ? (
        <div className="rounded-md border bg-muted/20 p-3">
          <p className="text-xs text-muted-foreground">
            {formatNumber(status.totalChars)} of {formatNumber(status.charLimit)} characters used
            across {formatNumber(status.totalDocuments)} of {formatNumber(status.documentLimit)}{' '}
            documents.
          </p>
          <Progress
            className="mt-2"
            value={usedPercent}
            tone={usedPercent >= 95 ? 'danger' : 'warning'}
            label="Knowledge base size used"
          />
        </div>
      ) : null}
    </div>
  );
}
