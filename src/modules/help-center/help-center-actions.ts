'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from '@/modules/company/data';
import { helpArticlePath, helpCenterPath } from './data';
import { removeArticleFromKnowledge, syncArticleToKnowledge } from './knowledge-sync';
import { isReservedHandle, SLUG_MAX, SLUG_PATTERN, slugify, uniqueSlug } from './slug';

/**
 * Writes for the help centre.
 *
 * WHO MAY DO WHAT
 * Agents write, admins publish. An agent answering the same question for the
 * eleventh time is the person who knows what the article should say, so they
 * can create one and edit it; putting text on the company's public website
 * under the company's name is an owner's decision, so publishing, withdrawing,
 * deleting, the category structure and the public handle are all
 * `company_admin`. That split is enforced HERE, in the actions, because the
 * forms import these directly — a button this session's user never sees is not
 * a permission check.
 *
 * NO PLAN GATE
 * `src/lib/entitlements.ts` gates on the seven keys in
 * `src/modules/super-admin/plans.ts` (whatsapp, flows, broadcasts, campaigns,
 * api_access, agency, custom_branding). None of them is a help centre, and this
 * feature is core rather than an upsell, so nothing here calls
 * `requireCompanyFeature`. If it should become paid, the key has to be added to
 * `PLAN_FEATURES` first and the gate goes on the page AND on every publish
 * action below.
 *
 * TENANCY
 * Every statement carries the session user's own company id and never one out
 * of the form. The service-role client bypasses RLS, so those filters are the
 * boundary; an `update` or `delete` without `.eq('company_id', companyId)` on
 * this page would be a cross-tenant write.
 */

export type ActionState = { error?: string; ok?: boolean };

const uuid = z.string().uuid();
const optionalUuid = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v))
  .refine((v) => v === null || uuid.safeParse(v).success, 'Pick a valid section');

function fail(message: string): ActionState {
  return { error: message };
}

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Please check the form and try again.';
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/**
 * The public pages render with `force-dynamic`, so a reader is never served
 * stale content. These calls are still worth making: they clear the router
 * cache the writer's own browser is holding, which is what makes "View live"
 * show the change they just saved instead of the version from a minute ago.
 */
async function revalidateHelpCenter(companyId: string, articleSlug?: string): Promise<void> {
  revalidatePath('/company/help-center');

  const sb = createSupabaseServiceClient();
  const [settingsRes, botRes] = await Promise.all([
    sb.from('help_center_settings').select('slug').eq('company_id', companyId).maybeSingle(),
    sb
      .from('bots')
      .select('public_bot_id')
      .eq('company_id', companyId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  const handles = [
    (settingsRes.data as { slug?: string | null } | null)?.slug ?? null,
    (botRes.data as { public_bot_id?: string } | null)?.public_bot_id ?? null,
  ].filter((h): h is string => Boolean(h));

  for (const handle of handles) {
    revalidatePath(helpCenterPath(handle));
    if (articleSlug) revalidatePath(helpArticlePath(handle, articleSlug));
  }
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const categorySchema = z.object({
  name: z.string().trim().min(1, 'Give the section a name').max(120, 'That name is too long'),
  description: z.string().trim().max(400, 'Keep the description under 400 characters').optional(),
});

export async function createHelpCategoryAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = categorySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));

  const sb = createSupabaseServiceClient();
  const { data: existing } = await sb
    .from('help_categories')
    .select('slug,position')
    .eq('company_id', companyId);

  const rows = (existing ?? []) as Array<{ slug: string; position: number }>;
  const slug = uniqueSlug(
    parsed.data.name,
    rows.map((r) => r.slug),
    'section',
  );

  const { error } = await sb.from('help_categories').insert({
    company_id: companyId,
    name: parsed.data.name,
    slug,
    description: parsed.data.description || null,
    // New sections land at the bottom rather than silently sharing position 0
    // with everything else, which is what makes "move up" mean something.
    position: rows.reduce((max, r) => Math.max(max, r.position), -1) + 1,
  });
  if (error) return fail(error.message);

  await revalidateHelpCenter(companyId);
  return { ok: true };
}

const updateCategorySchema = categorySchema.extend({ categoryId: uuid });

export async function updateHelpCategoryAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = updateCategorySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));

  const { error } = await createSupabaseServiceClient()
    .from('help_categories')
    .update({ name: parsed.data.name, description: parsed.data.description || null })
    .eq('id', parsed.data.categoryId)
    .eq('company_id', companyId); // scope guard
  if (error) return fail(error.message);

  await revalidateHelpCenter(companyId);
  return { ok: true };
}

/**
 * Deleting a section never deletes the writing inside it — the foreign key is
 * `on delete set null`, so the articles fall into the uncategorised bucket and
 * stay published. Someone tidying up their structure has not asked to
 * un-publish nine pages.
 */
export async function deleteHelpCategoryAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = z.object({ categoryId: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));

  const { error } = await createSupabaseServiceClient()
    .from('help_categories')
    .delete()
    .eq('id', parsed.data.categoryId)
    .eq('company_id', companyId); // scope guard
  if (error) return fail(error.message);

  await revalidateHelpCenter(companyId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

interface Orderable {
  id: string;
  position: number;
}

/**
 * Move one row up or down among its siblings.
 *
 * Positions are renumbered from zero first. They have to be: everything created
 * before a section existed can share position 0, and swapping two zeroes is a
 * no-op that looks to the user like a broken button. Renumbering costs one
 * update per row that actually moved, which for a help centre is a handful.
 */
async function moveWithin(
  table: 'help_categories' | 'help_articles',
  companyId: string,
  siblings: Orderable[],
  rowId: string,
  direction: 'up' | 'down',
): Promise<string | null> {
  const index = siblings.findIndex((row) => row.id === rowId);
  if (index < 0) return 'That item no longer exists.';

  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= siblings.length) return null; // already at the end

  const ordered = [...siblings];
  const moved = ordered[index];
  const displaced = ordered[target];
  if (!moved || !displaced) return null;
  ordered[index] = displaced;
  ordered[target] = moved;

  const sb = createSupabaseServiceClient();
  const writes = ordered
    .map((row, i) => ({ row, i }))
    .filter(({ row, i }) => row.position !== i)
    .map(({ row, i }) =>
      sb
        .from(table)
        .update({ position: i })
        .eq('id', row.id)
        .eq('company_id', companyId) // scope guard
        .then(() => undefined),
    );
  await Promise.all(writes);
  return null;
}

const moveSchema = z.object({
  id: uuid,
  direction: z.enum(['up', 'down']),
});

export async function moveHelpCategoryAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = moveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));

  const { data } = await createSupabaseServiceClient()
    .from('help_categories')
    .select('id,position')
    .eq('company_id', companyId)
    .order('position', { ascending: true })
    .order('name', { ascending: true });

  const error = await moveWithin(
    'help_categories',
    companyId,
    (data ?? []) as Orderable[],
    parsed.data.id,
    parsed.data.direction,
  );
  if (error) return fail(error);

  await revalidateHelpCenter(companyId);
  return { ok: true };
}

export async function moveHelpArticleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const companyId = await getCompanyId();
  const parsed = moveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));

  const sb = createSupabaseServiceClient();
  const { data: article } = await sb
    .from('help_articles')
    .select('id,category_id')
    .eq('company_id', companyId)
    .eq('id', parsed.data.id)
    .maybeSingle();
  if (!article) return fail('That article no longer exists.');

  // Order is per section: an article only ever moves past its own neighbours.
  const categoryId = (article as { category_id: string | null }).category_id;
  let query = sb.from('help_articles').select('id,position').eq('company_id', companyId);
  query = categoryId ? query.eq('category_id', categoryId) : query.is('category_id', null);
  const { data } = await query.order('position', { ascending: true }).order('title', { ascending: true });

  const error = await moveWithin(
    'help_articles',
    companyId,
    (data ?? []) as Orderable[],
    parsed.data.id,
    parsed.data.direction,
  );
  if (error) return fail(error);

  await revalidateHelpCenter(companyId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Articles
// ---------------------------------------------------------------------------

const createArticleSchema = z.object({
  title: z.string().trim().min(1, 'Give the article a title').max(200, 'That title is too long'),
  categoryId: optionalUuid.optional(),
});

/**
 * Create a draft and open it. Nothing is published by this action — a new
 * article starts as a draft, which is the whole point of having the state.
 */
export async function createHelpArticleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const companyId = await getCompanyId();
  const parsed = createArticleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));

  const sb = createSupabaseServiceClient();
  const { data: existing } = await sb
    .from('help_articles')
    .select('slug,position')
    .eq('company_id', companyId);
  const rows = (existing ?? []) as Array<{ slug: string; position: number }>;

  const { data, error } = await sb
    .from('help_articles')
    .insert({
      company_id: companyId,
      category_id: parsed.data.categoryId ?? null,
      title: parsed.data.title,
      slug: uniqueSlug(
        parsed.data.title,
        rows.map((r) => r.slug),
        'article',
      ),
      status: 'draft',
      position: rows.reduce((max, r) => Math.max(max, r.position), -1) + 1,
      author_id: user.userId,
    })
    .select('id')
    .single();
  if (error || !data) return fail(error?.message ?? 'Could not create the article.');

  revalidatePath('/company/help-center');
  redirect(`/company/help-center/${(data as { id: string }).id}`);
}

const saveArticleSchema = z.object({
  articleId: uuid,
  title: z.string().trim().min(1, 'Give the article a title').max(200, 'That title is too long'),
  slug: z.string().trim().max(SLUG_MAX, `Keep the web address under ${SLUG_MAX} characters`).optional(),
  excerpt: z.string().trim().max(400, 'Keep the summary under 400 characters').optional(),
  body: z.string().max(200_000, 'That article is too long to save').optional(),
  categoryId: optionalUuid.optional(),
  seoTitle: z.string().trim().max(200, 'Keep the page title under 200 characters').optional(),
  seoDescription: z
    .string()
    .trim()
    .max(320, 'Search engines cut descriptions off around 160 characters')
    .optional(),
});

export async function saveHelpArticleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const companyId = await getCompanyId();
  const parsed = saveArticleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const input = parsed.data;

  const sb = createSupabaseServiceClient();
  const { data: current } = await sb
    .from('help_articles')
    .select('id,slug,status,knowledge_document_id')
    .eq('company_id', companyId) // tenant boundary
    .eq('id', input.articleId)
    .maybeSingle();
  if (!current) return fail('That article no longer exists.');
  const existing = current as { slug: string; status: string; knowledge_document_id: string | null };

  // A blank slug field means "name it after the title"; a filled one is taken
  // literally, because the writer may be matching a URL they have already
  // handed out.
  const wanted = (input.slug ?? '').trim().toLowerCase() || slugify(input.title);
  const slug = wanted || existing.slug;
  if (!SLUG_PATTERN.test(slug)) {
    return fail('The web address can only use lowercase letters, numbers and hyphens.');
  }
  if (isReservedHandle(slug)) return fail('That web address is reserved. Pick another.');

  if (slug !== existing.slug) {
    const { data: clash } = await sb
      .from('help_articles')
      .select('id')
      .eq('company_id', companyId)
      .eq('slug', slug)
      .neq('id', input.articleId)
      .maybeSingle();
    if (clash) return fail('Another article already uses that web address.');
  }

  const body = input.body ?? '';
  const { error } = await sb
    .from('help_articles')
    .update({
      title: input.title,
      slug,
      excerpt: input.excerpt || null,
      body,
      category_id: input.categoryId ?? null,
      seo_title: input.seoTitle || null,
      seo_description: input.seoDescription || null,
    })
    .eq('id', input.articleId)
    .eq('company_id', companyId); // scope guard
  if (error) return fail(error.message);

  // A published article that has just been rewritten is stale in the assistant
  // until it is re-embedded, and an assistant quoting last week's refund policy
  // is worse than one that says nothing.
  if (existing.status === 'published') {
    const documentId = await syncArticleToKnowledge(companyId, {
      id: input.articleId,
      title: input.title,
      excerpt: input.excerpt ?? null,
      body,
    });
    if (documentId !== existing.knowledge_document_id) {
      await sb
        .from('help_articles')
        .update({ knowledge_document_id: documentId })
        .eq('id', input.articleId)
        .eq('company_id', companyId);
    }
  }

  await revalidateHelpCenter(companyId, slug);
  revalidatePath(`/company/help-center/${input.articleId}`);
  return { ok: true };
}

const articleIdSchema = z.object({ articleId: uuid });

export async function publishHelpArticleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = articleIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));

  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('help_articles')
    .select('id,title,slug,excerpt,body,published_at')
    .eq('company_id', companyId) // tenant boundary
    .eq('id', parsed.data.articleId)
    .maybeSingle();
  if (!data) return fail('That article no longer exists.');
  const article = data as {
    title: string;
    slug: string;
    excerpt: string | null;
    body: string;
    published_at: string | null;
  };

  if (!article.body.trim()) {
    return fail('Write something before publishing — an empty article helps nobody.');
  }

  const documentId = await syncArticleToKnowledge(companyId, {
    id: parsed.data.articleId,
    title: article.title,
    excerpt: article.excerpt,
    body: article.body,
  });

  const { error } = await sb
    .from('help_articles')
    .update({
      status: 'published',
      // First publication stamps the date; re-publishing after a withdrawal
      // keeps the original, because that is the date the article is credited
      // with everywhere it is cited.
      published_at: article.published_at ?? new Date().toISOString(),
      knowledge_document_id: documentId,
    })
    .eq('id', parsed.data.articleId)
    .eq('company_id', companyId); // scope guard
  if (error) return fail(error.message);

  await revalidateHelpCenter(companyId, article.slug);
  revalidatePath(`/company/help-center/${parsed.data.articleId}`);
  // Published either way. When the embedding failed, saying so beats a green
  // tick that is only two-thirds true — the page is live, the assistant is not
  // yet aware of it, and the writer has a button for exactly that.
  return documentId
    ? { ok: true }
    : { error: 'Published, but the assistant could not index it yet. Use "Update the assistant" below.' };
}

export async function unpublishHelpArticleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = articleIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));

  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('help_articles')
    .select('slug')
    .eq('company_id', companyId)
    .eq('id', parsed.data.articleId)
    .maybeSingle();
  if (!data) return fail('That article no longer exists.');

  // Withdraw it from the index first. If the update below failed afterwards the
  // worst case is an unindexed published article; the other order risks a
  // withdrawn article the assistant still recites.
  await removeArticleFromKnowledge(companyId, parsed.data.articleId);

  const { error } = await sb
    .from('help_articles')
    .update({ status: 'draft', knowledge_document_id: null })
    .eq('id', parsed.data.articleId)
    .eq('company_id', companyId); // scope guard
  if (error) return fail(error.message);

  await revalidateHelpCenter(companyId, (data as { slug: string }).slug);
  revalidatePath(`/company/help-center/${parsed.data.articleId}`);
  return { ok: true };
}

/** Re-embed a published article after an indexing failure. */
export async function reindexHelpArticleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const companyId = await getCompanyId();
  const parsed = articleIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));

  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('help_articles')
    .select('id,title,excerpt,body,status')
    .eq('company_id', companyId) // tenant boundary
    .eq('id', parsed.data.articleId)
    .maybeSingle();
  if (!data) return fail('That article no longer exists.');
  const article = data as { title: string; excerpt: string | null; body: string; status: string };
  if (article.status !== 'published') return fail('Only published articles are given to the assistant.');

  const documentId = await syncArticleToKnowledge(companyId, {
    id: parsed.data.articleId,
    title: article.title,
    excerpt: article.excerpt,
    body: article.body,
  });
  if (!documentId) return fail('The assistant could not index this article. Try again in a minute.');

  await sb
    .from('help_articles')
    .update({ knowledge_document_id: documentId })
    .eq('id', parsed.data.articleId)
    .eq('company_id', companyId);

  revalidatePath(`/company/help-center/${parsed.data.articleId}`);
  return { ok: true };
}

export async function deleteHelpArticleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = articleIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));

  // The indexed copy is a separate row in `documents` and would otherwise
  // survive the article and keep answering for it.
  await removeArticleFromKnowledge(companyId, parsed.data.articleId);

  const { error } = await createSupabaseServiceClient()
    .from('help_articles')
    .delete()
    .eq('id', parsed.data.articleId)
    .eq('company_id', companyId); // scope guard
  if (error) return fail(error.message);

  await revalidateHelpCenter(companyId);
  redirect('/company/help-center');
}

// ---------------------------------------------------------------------------
// The public surface
// ---------------------------------------------------------------------------

const settingsSchema = z.object({
  slug: z.string().trim().toLowerCase().max(SLUG_MAX, 'That web address is too long').optional(),
  title: z.string().trim().min(1, 'Give the help centre a title').max(120, 'That title is too long'),
  description: z
    .string()
    .trim()
    .max(320, 'Search engines cut descriptions off around 160 characters')
    .optional(),
  isPublished: z.string().optional(),
});

export async function saveHelpCenterSettingsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = settingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));

  const wanted = (parsed.data.slug ?? '').trim();
  let slug: string | null = null;
  if (wanted) {
    if (!SLUG_PATTERN.test(wanted)) {
      return fail('The web address can only use lowercase letters, numbers and hyphens.');
    }
    // A 32-character hex handle is the shape of a bot's public id, and letting
    // one company take that shape would let it shadow another company's help
    // centre at the same URL.
    if (isReservedHandle(wanted)) return fail('That web address is reserved. Pick another.');
    slug = wanted;
  }

  const sb = createSupabaseServiceClient();
  if (slug) {
    const { data: clash } = await sb
      .from('help_center_settings')
      .select('company_id')
      .eq('slug', slug)
      .neq('company_id', companyId)
      .maybeSingle();
    if (clash) return fail('Another business already uses that web address.');
  }

  const { error } = await sb.from('help_center_settings').upsert(
    {
      company_id: companyId,
      slug,
      title: parsed.data.title,
      description: parsed.data.description || null,
      is_published: parsed.data.isPublished === 'on',
    },
    { onConflict: 'company_id' },
  );
  if (error) {
    // The unique index on `slug` is the real guarantee; the check above only
    // narrows the race window.
    return fail(
      /duplicate key|unique/i.test(error.message)
        ? 'Another business already uses that web address.'
        : error.message,
    );
  }

  await revalidateHelpCenter(companyId);
  return { ok: true };
}
