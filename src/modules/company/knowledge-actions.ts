'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { ingestText } from '@/lib/ai/ingest';
import { getCompanyId } from './data';

export type ActionState = { error?: string; ok?: boolean };
export type WebsiteImportState = ActionState & {
  pagesImported?: number;
  importedUrls?: string[];
  missingPrompts?: string[];
};

const MAX_UPLOADED_KNOWLEDGE_FILES = 3;
const MAX_KNOWLEDGE_FILE_BYTES = 5 * 1024 * 1024;
const MAX_KNOWLEDGE_PDF_PAGES = 10;
const MAX_KNOWLEDGE_FILE_CHARS = 20000;

const addTextSchema = z.object({
  title: z.string().min(2, 'Title must be at least 2 characters'),
  text: z
    .string()
    .min(20, 'Add at least 20 characters of content')
    .max(50000, 'Content is too long (50,000 characters max)'),
  botId: z.preprocess((x) => (x === '' || x == null ? undefined : x), z.string().optional()),
});

function extractPageText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeWebsiteUrl(value: string): URL {
  return new URL(value.includes('://') ? value : `https://${value}`);
}

function titleFromHtml(html: string, fallback: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = extractPageText(match?.[1] ?? '').slice(0, 120);
  return title || fallback;
}

function scoreWebsitePath(url: URL): number {
  const path = `${url.pathname} ${url.search}`.toLowerCase();
  const keywords = [
    'about',
    'service',
    'services',
    'product',
    'products',
    'shop',
    'pricing',
    'price',
    'faq',
    'contact',
    'support',
    'shipping',
    'delivery',
    'refund',
    'return',
    'policy',
    'terms',
  ];
  return keywords.reduce((score, keyword) => score + (path.includes(keyword) ? 1 : 0), 0);
}

function extractSameDomainLinks(html: string, baseUrl: URL): string[] {
  const links = new Set<string>();
  const hrefRegex = /href\s*=\s*["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefRegex.exec(html))) {
    const raw = match[1]?.trim();
    if (!raw || raw.startsWith('#') || raw.startsWith('mailto:') || raw.startsWith('tel:')) continue;
    try {
      const next = new URL(raw, baseUrl);
      if (next.origin !== baseUrl.origin) continue;
      if (/\.(pdf|jpg|jpeg|png|gif|webp|zip|mp4|mov|docx?|xlsx?)$/i.test(next.pathname)) continue;
      next.hash = '';
      links.add(next.toString().replace(/\/$/, ''));
    } catch {
      continue;
    }
  }
  return [...links]
    .map((href) => new URL(href))
    .sort((a, b) => scoreWebsitePath(b) - scoreWebsitePath(a) || a.pathname.length - b.pathname.length)
    .slice(0, 12)
    .map((url) => url.toString());
}

async function fetchReadablePage(url: string): Promise<{ url: string; title: string; text: string; html: string } | null> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'AI Business Assistant website onboarding importer' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return null;
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType && !contentType.includes('text/html')) return null;
  const html = await res.text();
  const text = extractPageText(html);
  if (text.length < 100) return null;
  return { url, title: titleFromHtml(html, url), text, html };
}

function missingWebsitePrompts(text: string): string[] {
  const prompts: string[] = [];
  if (!/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(text) && !/\+?\d[\d\s().-]{7,}/.test(text)) {
    prompts.push('Add the best phone, WhatsApp, or email for customer follow-up.');
  }
  if (!/\b(mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday|hours|opening)\b/i.test(text)) {
    prompts.push('Add business hours or tell the bot how to handle after-hours messages.');
  }
  if (!/\b(refund|return|shipping|delivery|cancellation|warranty|policy)\b/i.test(text)) {
    prompts.push('Add delivery, refund, return, or cancellation policy if customers ask about it.');
  }
  if (!/\b(price|pricing|service|services|product|products|shop|catalog|catalogue)\b/i.test(text)) {
    prompts.push('Add services/products and prices, or connect a catalogue/integration.');
  }
  if (!/\b(book|appointment|schedule|quote|callback|consultation)\b/i.test(text)) {
    prompts.push('Choose what lead details the bot should collect before handing to your team.');
  }
  return prompts.slice(0, 5);
}

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

function cleanExtractedText(text: string): string {
  return text.replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

async function extractUploadedKnowledge(file: File): Promise<{
  title: string;
  text: string;
  sourceType: 'pdf' | 'docx' | 'txt';
}> {
  const name = file.name || 'Uploaded knowledge';
  const lower = name.toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());

  if (lower.endsWith('.pdf') || file.type === 'application/pdf') {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    try {
      const info = await parser.getInfo();
      const pages = typeof info.total === 'number' ? info.total : 0;
      if (pages > MAX_KNOWLEDGE_PDF_PAGES) {
        throw new Error(`PDFs are limited to ${MAX_KNOWLEDGE_PDF_PAGES} pages to control AI cost.`);
      }
      const parsed = await parser.getText();
      return { title: name.replace(/\.pdf$/i, ''), text: cleanExtractedText(parsed.text), sourceType: 'pdf' };
    } finally {
      await parser.destroy();
    }
  }

  if (lower.endsWith('.docx') || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const mammoth = await import('mammoth');
    const parsed = await mammoth.extractRawText({ buffer });
    return { title: name.replace(/\.docx$/i, ''), text: cleanExtractedText(parsed.value), sourceType: 'docx' };
  }

  if (lower.endsWith('.txt') || lower.endsWith('.md') || lower.endsWith('.csv') || file.type.startsWith('text/')) {
    return {
      title: name.replace(/\.(txt|md|csv)$/i, ''),
      text: cleanExtractedText(buffer.toString('utf8')),
      sourceType: 'txt',
    };
  }

  throw new Error('Upload a PDF, DOCX, TXT, Markdown, or CSV file.');
}

export async function addTextSourceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();

  const parsed = addTextSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const v = parsed.data;

  // If a bot was selected, verify it belongs to this company; otherwise treat as
  // company-wide (null). An invalid/foreign bot id is silently ignored.
  const botId = await verifiedBotId(companyId, v.botId);

  try {
    await ingestText({ companyId, botId, title: v.title, text: v.text, sourceType: 'text' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }

  revalidatePath('/company/knowledge');
  revalidatePath('/company/business-data');
  revalidatePath('/company/setup');
  revalidatePath('/company');
  return { ok: true };
}

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

  let html = '';
  try {
    const res = await fetch(v.url, {
      headers: { 'User-Agent': 'AI Business Assistant knowledge importer' },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return { error: `Could not fetch URL (${res.status})` };
    html = await res.text();
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not fetch URL' };
  }

  const text = extractPageText(html).slice(0, 50000);
  if (text.length < 100) return { error: 'Not enough readable text found on that page.' };

  try {
    await ingestText({
      companyId,
      botId,
      title: v.title ?? v.url,
      text,
      sourceType: 'url',
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }

  revalidatePath('/company/knowledge');
  revalidatePath('/company/business-data');
  revalidatePath('/company/setup');
  revalidatePath('/company');
  return { ok: true };
}

const importWebsiteSchema = z.object({
  websiteUrl: z.string().min(3, 'Enter your website URL'),
});

export async function importWebsiteOnboardingAction(
  _prev: WebsiteImportState,
  formData: FormData,
): Promise<WebsiteImportState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = importWebsiteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid website URL' };

  let startUrl: URL;
  try {
    startUrl = normalizeWebsiteUrl(parsed.data.websiteUrl);
  } catch {
    return { error: 'Enter a valid website URL.' };
  }

  let home: Awaited<ReturnType<typeof fetchReadablePage>>;
  try {
    home = await fetchReadablePage(startUrl.toString());
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not read website.' };
  }
  if (!home) return { error: 'Could not find enough readable text on the website home page.' };

  const candidateUrls = [
    home.url,
    ...extractSameDomainLinks(home.html, startUrl),
  ].filter((url, index, all) => all.indexOf(url) === index);

  const pages = [home];
  for (const url of candidateUrls.slice(1)) {
    if (pages.length >= 8) break;
    try {
      const page = await fetchReadablePage(url);
      if (page) pages.push(page);
    } catch {
      // Keep crawling other pages. A single blocked page should not fail onboarding.
    }
  }

  const sections = pages.map((page, index) =>
    [
      `Page ${index + 1}: ${page.title}`,
      `URL: ${page.url}`,
      '',
      page.text.slice(0, 7000),
    ].join('\n'),
  );
  const text = sections.join('\n\n---\n\n').slice(0, 50000);
  const missingPrompts = missingWebsitePrompts(text);

  try {
    await ingestText({
      companyId,
      botId: null,
      title: `Website import: ${startUrl.hostname}`,
      text,
      sourceType: 'url',
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }

  const sb = createSupabaseServiceClient();
  await sb.from('companies').update({ website: startUrl.origin }).eq('id', companyId);

  revalidatePath('/company/knowledge');
  revalidatePath('/company/business-data');
  revalidatePath('/company/setup');
  revalidatePath('/company');
  return {
    ok: true,
    pagesImported: pages.length,
    importedUrls: pages.map((page) => page.url),
    missingPrompts,
  };
}

export async function addFileSourceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const botIdInput = formData.get('botId');
  const botId = await verifiedBotId(companyId, typeof botIdInput === 'string' ? botIdInput : undefined);
  const file = formData.get('file');

  if (!(file instanceof File) || file.size === 0) return { error: 'Choose a file to upload.' };
  if (file.size > MAX_KNOWLEDGE_FILE_BYTES) return { error: 'Files are limited to 5 MB.' };

  const sb = createSupabaseServiceClient();
  const { count, error: countError } = await sb
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .in('source_type', ['pdf', 'docx', 'txt']);
  if (countError) return { error: countError.message };
  if ((count ?? 0) >= MAX_UPLOADED_KNOWLEDGE_FILES) {
    return { error: `Only ${MAX_UPLOADED_KNOWLEDGE_FILES} uploaded files are allowed. Delete an old file first.` };
  }

  try {
    const extracted = await extractUploadedKnowledge(file);
    const text = extracted.text.slice(0, MAX_KNOWLEDGE_FILE_CHARS);
    if (text.length < 100) return { error: 'Not enough readable text found in that file.' };
    await ingestText({ companyId, botId, title: extracted.title, text, sourceType: extracted.sourceType });
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }

  revalidatePath('/company/knowledge');
  revalidatePath('/company/business-data');
  revalidatePath('/company/setup');
  revalidatePath('/company');
  return { ok: true };
}

const deleteSchema = z.object({ documentId: z.string().uuid() });

export async function deleteDocumentAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const v = deleteSchema.parse(Object.fromEntries(formData));
  const sb = createSupabaseServiceClient();

  // Scope guard: only delete a document owned by THIS company. Chunks cascade.
  await sb.from('documents').delete().eq('id', v.documentId).eq('company_id', companyId);
  revalidatePath('/company/knowledge');
  revalidatePath('/company/business-data');
  revalidatePath('/company/setup');
  revalidatePath('/company');
}
