'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import {
  comparableHost,
  crawlStep,
  missingWebsitePrompts,
  normalizeWebsiteUrl,
  planCrawl,
  websiteValue,
  type CrawledPage,
} from '@/lib/knowledge/crawler';
import {
  createCrawlRun,
  getKnowledgeUsage,
  ingestKnowledge,
  knowledgeRoomError,
} from '@/lib/knowledge/ingest-queue';
import {
  MAX_COMPANY_KNOWLEDGE_CHARS,
  MAX_CRAWL_PAGES,
  MAX_PASTED_TEXT_CHARS,
  MIN_READABLE_PAGE_CHARS,
  SYNC_CRAWL_PAGES,
} from '@/lib/knowledge/limits';
import { getCompanyId } from './data';
import { findDocumentReferences } from './knowledge-data';

/**
 * `notice` is the honesty channel. A limit that fires has to produce a sentence
 * the admin can act on — "This PDF has 84 pages and we read the first 250" —
 * and `error` is the wrong place for it, because the document WAS added. The
 * same sentence is written onto the document row (`truncation_reason`) so it
 * survives the page reload that clears this state.
 *
 * `queued` says the work is on the background queue rather than finished, so
 * the form can point at the progress panel instead of claiming success.
 */
export type ActionState = {
  error?: string;
  ok?: boolean;
  notice?: string;
  queued?: boolean;
  documentId?: string;
};

export type WebsiteImportState = ActionState & {
  pagesImported?: number;
  importedUrls?: string[];
  missingPrompts?: string[];
  /** Pages handed to the background crawler after the first few. */
  queuedPages?: number;
  /** Whether the site published a sitemap or we had to follow links. */
  discovery?: 'sitemap' | 'links';
  /** Pages the site advertises in total, before the {@link MAX_CRAWL_PAGES} cap. */
  totalDiscovered?: number;
  crawlId?: string;
};

// --- Shared helpers ---------------------------------------------------------

async function verifiedBotId(companyId: string, botIdInput?: string): Promise<string | null> {
  if (!botIdInput) return null;
  const sb = createSupabaseServiceClient();
  const { data: bot } = await sb
    .from('bots')
    .select('id')
    .eq('company_id', companyId)
    .eq('id', botIdInput)
    .maybeSingle();
  return bot ? ((bot as Record<string, unknown>).id as string) : null;
}

function revalidateKnowledge(): void {
  revalidatePath('/company/knowledge');
  revalidatePath('/company/business-data');
  revalidatePath('/company/setup');
  revalidatePath('/company');
}

/** The one sentence the form shows after a successful add. */
function successNotice(params: {
  queued: boolean;
  replaced: boolean;
  truncationReason?: string | null;
}): string | undefined {
  const parts: string[] = [];
  if (params.truncationReason) parts.push(params.truncationReason);
  if (params.replaced) parts.push('This replaced the copy already saved for that address.');
  if (params.queued) {
    parts.push('It is queued for indexing — progress is shown below and your assistant will use it as soon as it finishes.');
  }
  return parts.length > 0 ? parts.join(' ') : undefined;
}

// --- Pasted text ------------------------------------------------------------

const addTextSchema = z.object({
  title: z.string().min(2, 'Title must be at least 2 characters'),
  text: z
    .string()
    .min(20, 'Add at least 20 characters of content')
    .max(
      MAX_PASTED_TEXT_CHARS,
      `Content is too long (${MAX_PASTED_TEXT_CHARS.toLocaleString()} characters max). Split it into two documents.`,
    ),
  botId: z.preprocess((x) => (x === '' || x == null ? undefined : x), z.string().optional()),
});

export async function addTextSourceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();

  const parsed = addTextSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const v = parsed.data;

  // If a bot was selected, verify it belongs to this company; otherwise treat as
  // company-wide (null). An invalid/foreign bot id is silently ignored.
  const botId = await verifiedBotId(companyId, v.botId);

  const full = await knowledgeRoomError(companyId, v.text.length);
  if (full) return { error: full };

  try {
    const result = await ingestKnowledge({
      companyId,
      botId,
      title: v.title,
      text: v.text,
      sourceType: 'text',
    });
    revalidateKnowledge();
    return {
      ok: true,
      documentId: result.documentId,
      queued: result.queued,
      notice: successNotice({ queued: result.queued, replaced: result.replaced }),
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// --- One web page -----------------------------------------------------------

const addUrlSchema = z.object({
  title: z.preprocess((x) => (x === '' || x == null ? undefined : x), z.string().optional()),
  url: z.string().url('Enter a valid URL'),
  botId: z.preprocess((x) => (x === '' || x == null ? undefined : x), z.string().optional()),
});

export async function addUrlSourceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = addUrlSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const v = parsed.data;
  const botId = await verifiedBotId(companyId, v.botId);

  let page: CrawledPage | null;
  try {
    // Same fetcher the crawler uses, so a page imported on its own and the same
    // page reached by a crawl produce identical text and the same `source_url`
    // key — which is what makes the second one an update rather than a copy.
    const { fetchReadablePage } = await import('@/lib/knowledge/crawler');
    page = await fetchReadablePage(v.url);
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not fetch URL' };
  }
  if (!page) {
    return {
      error: `Not enough readable text found at that address (we need at least ${MIN_READABLE_PAGE_CHARS} characters of text). Check the URL, or paste the content instead.`,
    };
  }

  const full = await knowledgeRoomError(companyId, page.text.length);
  if (full) return { error: full };

  try {
    const result = await ingestKnowledge({
      companyId,
      botId,
      title: v.title ?? page.title,
      text: page.text,
      sourceType: 'url',
      sourceUrl: page.url,
      truncation: page.truncation,
    });
    revalidateKnowledge();
    return {
      ok: true,
      documentId: result.documentId,
      queued: result.queued,
      notice: successNotice({
        queued: result.queued,
        replaced: result.replaced,
        truncationReason: page.truncation.reason,
      }),
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// --- Whole website ----------------------------------------------------------

const importWebsiteSchema = z.object({
  websiteUrl: z.string().min(3, 'Enter your website URL'),
});

/**
 * Import a website as one document PER PAGE.
 *
 * The shape here is deliberate. A 60-page crawl takes minutes, so it cannot all
 * happen in this request — but returning "queued, come back later" with nothing
 * indexed makes the onboarding step feel broken. So the first
 * {@link SYNC_CRAWL_PAGES} pages are fetched and indexed now, which is enough
 * for the assistant to answer something and for this action to report real URLs,
 * and the rest is handed to `background_jobs` and reported as a page count with
 * live progress.
 *
 * Re-running it on the same address is a RECRAWL: each page keys on
 * `(company_id, source_url)`, so pages that still exist are updated in place and
 * new pages are added. It does not leave a second copy of the site behind, which
 * the previous single-merged-document importer did every single time.
 */
export async function importWebsiteOnboardingAction(
  _prev: WebsiteImportState,
  formData: FormData,
): Promise<WebsiteImportState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = importWebsiteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid website URL' };

  const botIdInput = formData.get('botId');
  const botId = await verifiedBotId(companyId, typeof botIdInput === 'string' ? botIdInput : undefined);

  let startUrl: URL;
  try {
    startUrl = normalizeWebsiteUrl(parsed.data.websiteUrl);
  } catch {
    return { error: 'Enter a valid website URL.' };
  }

  const usage = await getKnowledgeUsage(companyId);
  if (usage.charsRemaining <= 0) {
    return {
      error: `Your knowledge base is at its ${MAX_COMPANY_KNOWLEDGE_CHARS.toLocaleString()}-character limit. Delete something before importing a website.`,
    };
  }

  let plan;
  try {
    plan = await planCrawl(startUrl, MAX_CRAWL_PAGES);
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not read website.' };
  }

  const importedUrls: string[] = [];
  const combinedText: string[] = [];
  let charBudget = usage.charsRemaining;

  const firstPass = await crawlStep({
    root: startUrl,
    discovery: plan.discovery,
    queue: plan.queue,
    seen: [],
    pageLimit: Math.min(SYNC_CRAWL_PAGES, MAX_CRAWL_PAGES),
    // Fetch a handful now, but keep discovering up to the full crawl ceiling so
    // the background job inherits a real queue rather than three URLs.
    frontierLimit: MAX_CRAWL_PAGES,
    alreadyIngested: 0,
    // A hard wall on the synchronous half, so a slow site cannot hold the
    // request open past what a browser will wait for.
    deadline: Date.now() + 25_000,
    onPage: async (page) => {
      // Returning false stops the pass and leaves this URL for the queue, so a
      // company at its size limit is not credited with a page it never stored.
      if (charBudget < MIN_READABLE_PAGE_CHARS) return false;
      const text = page.text.slice(0, charBudget);
      charBudget -= text.length;
      await ingestKnowledge({
        companyId,
        botId,
        title: page.title,
        text,
        sourceType: 'url',
        sourceUrl: page.url,
        truncation: page.truncation,
      });
      importedUrls.push(page.url);
      combinedText.push(text);
      return true;
    },
  });

  if (importedUrls.length === 0) {
    return {
      error:
        'We could not read any public pages at that address. Check the URL is your live site, or paste your key details as text knowledge instead.',
    };
  }

  // Anything the first pass did not reach goes on the queue, attributed to a
  // crawl row so the panel can show "12 of 47 pages read".
  const pending = firstPass.remaining.filter((url) => !importedUrls.includes(url));
  let crawlId: string | undefined;
  try {
    crawlId = await createCrawlRun({
      companyId,
      botId,
      rootUrl: startUrl,
      discovery: plan.discovery,
      discovered: plan.discovery === 'sitemap' ? plan.discovered : importedUrls.length + pending.length,
      pending,
      ingested: importedUrls.length,
      failed: firstPass.failed,
    });
    // The pages just ingested belong to this crawl too, so a recrawl and the
    // progress count can both see them.
    if (crawlId) {
      await createSupabaseServiceClient()
        .from('documents')
        .update({ crawl_id: crawlId })
        .eq('company_id', companyId)
        .in('source_url', importedUrls);
    }
  } catch (err) {
    // The pages that were indexed are still indexed; only the queued remainder
    // is lost, and saying so beats failing the whole import.
    return {
      ok: true,
      pagesImported: importedUrls.length,
      importedUrls,
      missingPrompts: missingWebsitePrompts(combinedText.join('\n')),
      discovery: plan.discovery,
      totalDiscovered: plan.discovered,
      notice: `We indexed ${importedUrls.length} pages, but could not queue the rest: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Issue #17: the profile form is the admin's own typed website. Only fill it in
  // when it is still empty, or when the imported site is a genuinely different host
  // (the stored value is then stale). Never rewrite it just to strip a path the
  // admin set on purpose — `https://x.com/en` must not become `https://x.com`.
  const sb = createSupabaseServiceClient();
  const { data: company } = await sb.from('companies').select('website').eq('id', companyId).maybeSingle();
  const currentWebsite = ((company as { website?: string | null } | null)?.website ?? '').trim();
  if (!currentWebsite || comparableHost(currentWebsite) !== comparableHost(startUrl.toString())) {
    await sb.from('companies').update({ website: websiteValue(startUrl) }).eq('id', companyId);
  }

  revalidateKnowledge();
  return {
    ok: true,
    crawlId,
    pagesImported: importedUrls.length,
    importedUrls,
    missingPrompts: missingWebsitePrompts(combinedText.join('\n')),
    queuedPages: pending.length,
    discovery: plan.discovery,
    totalDiscovered: plan.discovered,
    queued: pending.length > 0,
    notice:
      pending.length > 0
        ? `${pending.length} more page${pending.length === 1 ? '' : 's'} ${pending.length === 1 ? 'is' : 'are'} queued and will be indexed in the background — progress is shown below.`
        : undefined,
  };
}

const recrawlSchema = z.object({ crawlId: z.string().uuid() });

/**
 * Run a previous website import again. Pages that still exist are updated in
 * place (same `source_url`, same document id) and pages that have appeared
 * since are added — so a shop that changed its shipping policy can refresh what
 * the assistant knows without deleting anything or ending up with two copies.
 */
export async function recrawlWebsiteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = recrawlSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Choose a website import to refresh.' };

  const sb = createSupabaseServiceClient();
  const { data: crawl } = await sb
    .from('knowledge_crawls')
    .select('id, root_url, bot_id, status')
    .eq('id', parsed.data.crawlId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (!crawl) return { error: 'That website import no longer exists.' };

  const row = crawl as { id: string; root_url: string; bot_id: string | null; status: string };
  if (row.status === 'queued' || row.status === 'running') {
    return { error: 'That import is still running. Wait for it to finish before refreshing it.' };
  }

  let startUrl: URL;
  try {
    startUrl = normalizeWebsiteUrl(row.root_url);
  } catch {
    return { error: 'That import has an address we can no longer read.' };
  }

  try {
    const plan = await planCrawl(startUrl, MAX_CRAWL_PAGES);

    // A refresh is a NEW crawl run, not a rewind of the old one. `runCrawlJob`
    // works out what it has already done from the documents carrying its own
    // crawl id, so reusing the finished row would make it believe the whole site
    // was already read. The pages themselves are not touched: each one keys on
    // (company_id, source_url), so the new run updates them in place — which is
    // the entire point of a refresh — and the superseded run row is dropped so
    // the panel shows one entry per site rather than a growing history.
    await createCrawlRun({
      companyId,
      botId: row.bot_id,
      rootUrl: startUrl,
      discovery: plan.discovery,
      discovered: plan.discovery === 'sitemap' ? plan.discovered : plan.queue.length,
      pending: plan.queue,
      ingested: 0,
      failed: 0,
    });
    await sb.from('knowledge_crawls').delete().eq('id', row.id).eq('company_id', companyId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not start the refresh.' };
  }

  revalidateKnowledge();
  return { ok: true, queued: true, notice: 'Refresh queued. Existing pages are updated, not duplicated.' };
}

// --- Uploaded files ---------------------------------------------------------

/**
 * Server-action upload, kept for anything already posting to it.
 *
 * The knowledge form itself now uploads through
 * `POST /api/company/knowledge/upload` instead, and it has to: Next caps a
 * server action's request body at 1 MB by default and this project sets no
 * `serverActions.bodySizeLimit`, so the "5 MB" this used to advertise was never
 * actually reachable — a 3 MB PDF failed in the framework with a generic error
 * before a line of this ran. A route handler has no such cap.
 */
export async function addFileSourceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const botIdInput = formData.get('botId');
  const botId = await verifiedBotId(companyId, typeof botIdInput === 'string' ? botIdInput : undefined);
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose a file to upload.' };

  const { ingestUploadedFile } = await import('@/lib/knowledge/upload');
  try {
    const result = await ingestUploadedFile({
      companyId,
      botId,
      buffer: Buffer.from(await file.arrayBuffer()),
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
    });
    revalidateKnowledge();
    return {
      ok: true,
      documentId: result.documentId,
      queued: result.queued,
      notice: successNotice({
        queued: result.queued,
        replaced: false,
        truncationReason: result.truncationReason,
      }),
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// --- Delete -----------------------------------------------------------------

const deleteSchema = z.object({ documentId: z.string().uuid() });

export async function deleteDocumentAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const v = deleteSchema.parse(Object.fromEntries(formData));
  const sb = createSupabaseServiceClient();

  // Issue #15: policies and FAQs own the document they generated (their
  // `document_id` points at it). Deleting it from here would leave the policy/FAQ
  // listed in Business Data with a dangling reference and zero RAG coverage, so
  // refuse and say what owns it. Both delete forms are typed
  // `(formData) => Promise<void>`, so throwing is the only channel that reaches
  // the admin instead of failing silently.
  const reference = (await findDocumentReferences(companyId, [v.documentId])).get(v.documentId);
  if (reference) {
    const owner = reference.kind === 'policy' ? 'policy' : 'FAQ';
    throw new Error(
      `This document is generated from the ${owner} "${reference.label}" and cannot be deleted on its own. ` +
        `Delete or edit that ${owner} in Business Data — it keeps its knowledge in sync automatically.`,
    );
  }

  // Scope guard: only delete a document owned by THIS company. Chunks cascade.
  await sb.from('documents').delete().eq('id', v.documentId).eq('company_id', companyId);
  revalidateKnowledge();
}
