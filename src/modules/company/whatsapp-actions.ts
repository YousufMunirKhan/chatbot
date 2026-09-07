'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { logger } from '@/lib/logger';
import {
  createMetaTemplate,
  deleteMetaTemplate,
  listMetaTemplates,
  normalizeTemplateName,
  type TemplateButton,
  type TemplateCategory,
} from '@/lib/channels/whatsapp-templates';
import { normalizeWhatsAppNumber } from '@/lib/channels/whatsapp';
import { getCompanyId } from './data';
import { getPrimaryWhatsAppCredentials } from './whatsapp-data';

export type ActionState = { error?: string; ok?: boolean };

const optText = z.preprocess((x) => (x === '' || x == null ? undefined : x), z.string().optional());

const TEMPLATES_PATH = '/company/whatsapp/templates';
const SUBSCRIBERS_PATH = '/company/whatsapp/subscribers';
const HOME_PATH = '/company/whatsapp';

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const templateSchema = z.object({
  name: z.string().min(1, 'Template name is required').max(120),
  language: z.string().min(2).max(10).default('en_US'),
  category: z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']).default('MARKETING'),
  body: z.string().min(1, 'Body text is required').max(1024),
  headerText: optText,
  footerText: optText,
  buttons: optText,
  submit: optText,
});

/** One button per line: "Label" | "Label|https://…" | "Label|+9715…". */
function parseButtons(raw: string | undefined): TemplateButton[] {
  if (!raw) return [];
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 10)
    .map((line) => {
      const [labelRaw, targetRaw] = line.split('|');
      const text = (labelRaw ?? '').trim().slice(0, 25);
      const target = (targetRaw ?? '').trim();
      if (/^https?:\/\//i.test(target)) return { type: 'URL' as const, text, url: target };
      if (/^\+?\d[\d\s-]{5,}$/.test(target)) return { type: 'PHONE_NUMBER' as const, text, phone_number: target };
      return { type: 'QUICK_REPLY' as const, text };
    })
    .filter((b) => Boolean(b.text));
}

export async function createWhatsAppTemplateAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = templateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid template' };
  const v = parsed.data;

  const name = normalizeTemplateName(v.name);
  if (!name) return { error: 'Template name must contain letters or digits.' };

  const buttons = parseButtons(v.buttons);
  const draft = {
    name,
    language: v.language,
    category: v.category as TemplateCategory,
    body: v.body,
    header: v.headerText ? { format: 'TEXT' as const, text: v.headerText } : null,
    footer: v.footerText ?? null,
    buttons,
  };

  // Submitting to Meta is optional: a company can draft templates before the
  // WhatsApp Business Account id is known and submit them later.
  let status: 'draft' | 'pending' = 'draft';
  let metaTemplateId: string | null = null;
  if (v.submit === 'on' || v.submit === 'true') {
    const creds = await getPrimaryWhatsAppCredentials();
    if (!creds?.token) return { error: 'Connect a WhatsApp number with an access token first.' };
    if (!creds.wabaId) return { error: 'Add your WhatsApp Business Account (WABA) id on the WhatsApp page first.' };
    const res = await createMetaTemplate(creds.token, creds.wabaId, draft);
    if (!res.ok) return { error: res.error ?? 'Meta rejected the template.' };
    status = 'pending';
    metaTemplateId = res.id ?? null;
  }

  const sb = createSupabaseServiceClient();
  const { error } = await sb.from('whatsapp_templates').upsert(
    {
      company_id: companyId,
      name,
      language: v.language,
      category: v.category,
      body: v.body,
      header: draft.header,
      footer: v.footerText ? { text: v.footerText } : null,
      buttons,
      status,
      meta_template_id: metaTemplateId,
      rejection_reason: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'company_id,name,language' },
  );
  if (error) return { error: error.message };

  revalidatePath(TEMPLATES_PATH);
  return { ok: true };
}

/** Submit an existing draft to Meta for review. */
export async function submitWhatsAppTemplateAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return;

  const sb = createSupabaseServiceClient();
  // TENANT ISOLATION: the row must belong to the caller's company.
  const { data } = await sb
    .from('whatsapp_templates')
    .select('name,language,category,body,header,footer,buttons')
    .eq('company_id', companyId)
    .eq('id', id.data)
    .maybeSingle();
  if (!data) return;
  const row = data as Record<string, unknown>;

  const creds = await getPrimaryWhatsAppCredentials();
  if (!creds?.token || !creds.wabaId) {
    await sb
      .from('whatsapp_templates')
      .update({ rejection_reason: 'Connect a WhatsApp number and set the WABA id before submitting.' })
      .eq('company_id', companyId)
      .eq('id', id.data);
    revalidatePath(TEMPLATES_PATH);
    return;
  }

  const header = (row.header ?? null) as { format?: string; text?: string } | null;
  const footer = (row.footer ?? null) as { text?: string } | null;
  const res = await createMetaTemplate(creds.token, creds.wabaId, {
    name: row.name as string,
    language: row.language as string,
    category: row.category as TemplateCategory,
    body: row.body as string,
    header: header?.text ? { format: 'TEXT', text: header.text } : null,
    footer: footer?.text ?? null,
    buttons: Array.isArray(row.buttons) ? (row.buttons as TemplateButton[]) : [],
  });

  await sb
    .from('whatsapp_templates')
    .update(
      res.ok
        ? { status: 'pending', meta_template_id: res.id ?? null, rejection_reason: null, updated_at: new Date().toISOString() }
        : { rejection_reason: res.error ?? 'Meta rejected the template.', updated_at: new Date().toISOString() },
    )
    .eq('company_id', companyId)
    .eq('id', id.data);

  revalidatePath(TEMPLATES_PATH);
}

/**
 * Pull approval status back from Meta for every template on the WABA.
 *
 * Returns a result rather than void so a failed sync can say so on screen —
 * silently leaving stale statuses on a page whose whole job is showing status
 * is worse than showing an error.
 */
export async function syncWhatsAppTemplatesAction(): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const creds = await getPrimaryWhatsAppCredentials();
  if (!creds?.token || !creds.wabaId) {
    return { error: 'Add your WhatsApp Business Account id and an access token before syncing.' };
  }

  const res = await listMetaTemplates(creds.token, creds.wabaId);
  if (!res.ok) {
    logger.warn('WhatsApp template sync failed', { companyId, error: res.error });
    return { error: res.error ?? 'Meta refused the template sync. Check the token has whatsapp_business_management.' };
  }

  const sb = createSupabaseServiceClient();
  const now = new Date().toISOString();
  let failures = 0;

  for (const t of res.templates) {
    if (!t.name) continue;
    const language = t.language || 'en_US';
    const category = ['MARKETING', 'UTILITY', 'AUTHENTICATION'].includes(t.category)
      ? t.category
      : 'MARKETING';

    // Sync is a STATUS refresh. An earlier version upserted a literal
    // "(managed in Meta)" into `body`, so every sync destroyed the copy the
    // company had written and approved. The body is only ever written when we
    // actually have one: Meta's, or a placeholder for a template that exists
    // only in Meta and has no local row yet.
    const { data: existing } = await sb
      .from('whatsapp_templates')
      .select('id')
      .eq('company_id', companyId)
      .eq('name', t.name)
      .eq('language', language)
      .maybeSingle();

    const status = {
      category,
      status: t.status,
      meta_template_id: t.id || null,
      rejection_reason: t.rejectionReason,
      updated_at: now,
    };

    const { error } = existing
      ? await sb
          .from('whatsapp_templates')
          // Only refresh the body when Meta returned one.
          .update(t.body ? { ...status, body: t.body } : status)
          .eq('company_id', companyId)
          .eq('id', (existing as { id: string }).id)
      : await sb.from('whatsapp_templates').insert({
          company_id: companyId,
          name: t.name,
          language,
          body: t.body ?? '(created in Meta — open it there to see the text)',
          ...status,
        });

    if (error) {
      failures += 1;
      logger.warn('Template sync write failed', { companyId, name: t.name, error: error.message });
    }
  }

  revalidatePath(TEMPLATES_PATH);
  // Sync failures used to be logged and swallowed, so the screen said nothing
  // while showing stale statuses.
  if (failures > 0) {
    return {
      error: `Synced ${res.templates.length - failures} of ${res.templates.length} templates. ${failures} could not be saved — try again, or check the server logs.`,
    };
  }
  return { ok: true };
}

export async function deleteWhatsAppTemplateAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return;

  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('whatsapp_templates')
    .select('name,meta_template_id')
    .eq('company_id', companyId)
    .eq('id', id.data)
    .maybeSingle();
  if (!data) return;
  const row = data as { name: string; meta_template_id: string | null };

  if (row.meta_template_id) {
    const creds = await getPrimaryWhatsAppCredentials();
    if (creds?.token && creds.wabaId) await deleteMetaTemplate(creds.token, creds.wabaId, row.name);
  }

  await sb.from('whatsapp_templates').delete().eq('company_id', companyId).eq('id', id.data);
  revalidatePath(TEMPLATES_PATH);
}

// ---------------------------------------------------------------------------
// Subscribers
// ---------------------------------------------------------------------------

const subscriberSchema = z.object({
  contact: z.string().min(3, 'A phone number is required').max(64),
  channel: z.enum(['whatsapp', 'email', 'sms']).default('whatsapp'),
  optedIn: optText,
});

export async function upsertSubscriberAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = subscriberSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid subscriber' };
  const v = parsed.data;

  const identifier =
    v.channel === 'email' ? v.contact.trim().toLowerCase() : normalizeWhatsAppNumber(v.contact);
  if (!identifier) return { error: 'That contact could not be read as a phone number.' };

  const optedIn = v.optedIn === 'on' || v.optedIn === 'true';
  const now = new Date().toISOString();
  const sb = createSupabaseServiceClient();
  const { error } = await sb.from('contact_subscriptions').upsert(
    {
      company_id: companyId,
      channel: v.channel,
      contact_identifier: identifier,
      opted_in: optedIn,
      source: 'manual',
      opted_in_at: optedIn ? now : null,
      opted_out_at: optedIn ? null : now,
      updated_at: now,
    },
    { onConflict: 'company_id,channel,contact_identifier' },
  );
  if (error) return { error: error.message };

  revalidatePath(SUBSCRIBERS_PATH);
  return { ok: true };
}

/** Flip one subscriber's consent from the list (manual opt-out honours STOP). */
export async function setSubscriptionAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return;
  const optedIn = formData.get('optedIn') === 'true';
  const now = new Date().toISOString();

  const sb = createSupabaseServiceClient();
  await sb
    .from('contact_subscriptions')
    .update({
      opted_in: optedIn,
      opted_in_at: optedIn ? now : null,
      opted_out_at: optedIn ? null : now,
      updated_at: now,
    })
    .eq('company_id', companyId)
    .eq('id', id.data);
  revalidatePath(SUBSCRIBERS_PATH);
}

// ---------------------------------------------------------------------------
// Catalog + account
// ---------------------------------------------------------------------------

const catalogSchema = z.object({
  catalogId: optText,
  isActive: optText,
});

export async function saveCatalogSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = catalogSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid catalog settings' };
  const v = parsed.data;
  const catalogId = (v.catalogId ?? '').trim() || null;
  const isActive = (v.isActive === 'on' || v.isActive === 'true') && Boolean(catalogId);

  const sb = createSupabaseServiceClient();
  const { error } = await sb.from('whatsapp_catalog_settings').upsert(
    {
      company_id: companyId,
      catalog_id: catalogId,
      is_active: isActive,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'company_id' },
  );
  if (error) return { error: error.message };

  revalidatePath(HOME_PATH);
  return { ok: true };
}

const retailerSchema = z.object({
  productId: z.string().uuid(),
  retailerId: optText,
});

/** Map one synced product onto its Meta commerce `retailer_id`. */
export async function setProductRetailerIdAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = retailerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;

  const sb = createSupabaseServiceClient();
  await sb
    .from('synced_products')
    .update({ whatsapp_retailer_id: (parsed.data.retailerId ?? '').trim() || null })
    // TENANT ISOLATION: company_id in the filter, not just the product id.
    .eq('company_id', companyId)
    .eq('id', parsed.data.productId);

  revalidatePath(HOME_PATH);
}

const wabaSchema = z.object({
  identityId: z.string().uuid(),
  wabaId: optText,
});

/**
 * Store the WhatsApp Business Account id alongside the phone number id. Meta
 * needs it for every template call and does not include it in the webhook.
 */
export async function saveWabaIdAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = wabaSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Invalid WhatsApp Business Account id' };

  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('channel_identities')
    .select('settings_json')
    .eq('company_id', companyId)
    .eq('id', parsed.data.identityId)
    .maybeSingle();
  if (!data) return { error: 'That WhatsApp number was not found for your company.' };

  const settings = ((data as Record<string, unknown>).settings_json ?? {}) as Record<string, unknown>;
  const { error } = await sb
    .from('channel_identities')
    .update({ settings_json: { ...settings, waba_id: (parsed.data.wabaId ?? '').trim() || null } })
    .eq('company_id', companyId)
    .eq('id', parsed.data.identityId);
  if (error) return { error: error.message };

  revalidatePath(HOME_PATH);
  revalidatePath(TEMPLATES_PATH);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Guides
// ---------------------------------------------------------------------------

const guideSchema = z.object({
  guide: z.enum(['blue_tick', 'bsp_migration']),
  stepKey: z.string().min(1).max(120),
  done: z.string(),
});

export async function toggleGuideStepAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = guideSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;

  const sb = createSupabaseServiceClient();
  await sb.from('whatsapp_guide_progress').upsert(
    {
      company_id: companyId,
      guide: parsed.data.guide,
      step_key: parsed.data.stepKey,
      done: parsed.data.done === 'true',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'company_id,guide,step_key' },
  );
  revalidatePath(HOME_PATH);
}
