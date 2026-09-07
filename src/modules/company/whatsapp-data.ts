import { createSupabaseServiceClient } from '@/lib/db/server';
import { decryptSecret } from '@/lib/crypto';
import { fetchWhatsAppAccountStatus, type WhatsAppAccountStatus } from '@/lib/channels/whatsapp-account';
import type { GuideKey } from '@/lib/channels/whatsapp-guides';
import { getCompanyId } from './data';

/**
 * Read side of the WhatsApp Business suite. Every query is scoped by
 * `company_id` — a company must never see another tenant's templates,
 * subscribers, catalog mapping or account health.
 */

export interface WhatsAppIdentity {
  id: string;
  /** Meta phone number id (Cloud API) or "+digits" (Twilio). */
  externalId: string;
  provider: string;
  wabaId: string | null;
  hasToken: boolean;
  isActive: boolean;
}

export interface WhatsAppTemplateRow {
  id: string;
  name: string;
  language: string;
  category: string;
  body: string;
  headerText: string | null;
  footerText: string | null;
  buttons: Array<{ type: string; text: string; url?: string; phone_number?: string }>;
  status: string;
  metaTemplateId: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

export interface SubscriberRow {
  id: string;
  channel: string;
  contactIdentifier: string;
  optedIn: boolean;
  source: string;
  optedInAt: string | null;
  optedOutAt: string | null;
  updatedAt: string;
}

export interface CatalogSettings {
  catalogId: string | null;
  isActive: boolean;
}

export interface CatalogProductRow {
  id: string;
  title: string;
  sku: string | null;
  price: number | null;
  currency: string;
  retailerId: string | null;
}

const rec = (v: unknown): Record<string, unknown> => (v ?? {}) as Record<string, unknown>;

/** Decrypt a stored channel secret, tolerating rows written before encryption. */
function readSecret(raw: string | null): string | null {
  if (!raw) return null;
  try {
    return decryptSecret(raw);
  } catch {
    return raw;
  }
}

/** Every WhatsApp number connected by this company (newest first). */
export async function listWhatsAppIdentities(): Promise<WhatsAppIdentity[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('channel_identities')
    .select('id,external_id,settings_json,secret_encrypted,is_active,created_at')
    .eq('company_id', companyId)
    .eq('channel', 'whatsapp')
    .order('created_at', { ascending: false })
    .limit(50);
  return (data ?? []).map((r) => {
    const x = rec(r);
    const settings = rec(x.settings_json);
    return {
      id: x.id as string,
      externalId: x.external_id as string,
      provider: (settings.provider as string) ?? 'meta_cloud',
      wabaId: (settings.waba_id as string) ?? null,
      hasToken: Boolean(x.secret_encrypted),
      isActive: x.is_active !== false,
    };
  });
}

/**
 * The identity used for template management and account health, with its
 * decrypted token. Server-only — the token never reaches a page prop.
 */
export async function getPrimaryWhatsAppCredentials(): Promise<{
  identityId: string;
  phoneNumberId: string;
  wabaId: string | null;
  token: string | null;
} | null> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('channel_identities')
    .select('id,external_id,settings_json,secret_encrypted')
    .eq('company_id', companyId)
    .eq('channel', 'whatsapp')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const x = rec(data);
  const settings = rec(x.settings_json);
  return {
    identityId: x.id as string,
    phoneNumberId: x.external_id as string,
    wabaId: (settings.waba_id as string) ?? null,
    token: readSecret((x.secret_encrypted as string) ?? null),
  };
}

export async function listWhatsAppTemplates(): Promise<WhatsAppTemplateRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('whatsapp_templates')
    .select('id,name,language,category,body,header,footer,buttons,status,meta_template_id,rejection_reason,created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(200);
  return (data ?? []).map((r) => {
    const x = rec(r);
    const header = rec(x.header);
    const footer = rec(x.footer);
    return {
      id: x.id as string,
      name: x.name as string,
      language: x.language as string,
      category: x.category as string,
      body: x.body as string,
      headerText: (header.text as string) ?? null,
      footerText: (footer.text as string) ?? null,
      buttons: Array.isArray(x.buttons) ? (x.buttons as WhatsAppTemplateRow['buttons']) : [],
      status: x.status as string,
      metaTemplateId: (x.meta_template_id as string) ?? null,
      rejectionReason: (x.rejection_reason as string) ?? null,
      createdAt: x.created_at as string,
    };
  });
}

/** Subscribers, optionally narrowed by a contact substring from the search box. */
export async function listSubscribers(search?: string): Promise<SubscriberRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  let query = sb
    .from('contact_subscriptions')
    .select('id,channel,contact_identifier,opted_in,source,opted_in_at,opted_out_at,updated_at')
    .eq('company_id', companyId);
  const term = (search ?? '').trim();
  if (term) {
    // Escape PostgREST's pattern metacharacters so a "%" typed in the search box
    // cannot widen the filter.
    query = query.ilike('contact_identifier', `%${term.replace(/[%_,()]/g, '')}%`);
  }
  const { data } = await query.order('updated_at', { ascending: false }).limit(500);
  return (data ?? []).map((r) => {
    const x = rec(r);
    return {
      id: x.id as string,
      channel: x.channel as string,
      contactIdentifier: x.contact_identifier as string,
      optedIn: x.opted_in !== false,
      source: (x.source as string) ?? 'manual',
      optedInAt: (x.opted_in_at as string) ?? null,
      optedOutAt: (x.opted_out_at as string) ?? null,
      updatedAt: x.updated_at as string,
    };
  });
}

export async function getCatalogSettings(): Promise<CatalogSettings> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('whatsapp_catalog_settings')
    .select('catalog_id,is_active')
    .eq('company_id', companyId)
    .maybeSingle();
  if (!data) return { catalogId: null, isActive: false };
  const x = rec(data);
  return { catalogId: (x.catalog_id as string) ?? null, isActive: x.is_active === true };
}

/** Synced products with their WhatsApp commerce retailer id mapping. */
export async function listCatalogProducts(): Promise<CatalogProductRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('synced_products')
    .select('id,title,sku,price,currency,whatsapp_retailer_id')
    .eq('company_id', companyId)
    .order('title', { ascending: true })
    .limit(200);
  return (data ?? []).map((r) => {
    const x = rec(r);
    const price = x.price == null ? null : Number(x.price);
    return {
      id: x.id as string,
      title: x.title as string,
      sku: (x.sku as string) ?? null,
      price: price != null && Number.isFinite(price) ? price : null,
      currency: (x.currency as string) ?? 'USD',
      retailerId: (x.whatsapp_retailer_id as string) ?? null,
    };
  });
}

/** Checked steps per guide: `progress.blue_tick.display_name === true`. */
export async function getGuideProgress(): Promise<Record<GuideKey, Record<string, boolean>>> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('whatsapp_guide_progress')
    .select('guide,step_key,done')
    .eq('company_id', companyId)
    .limit(500);
  const out: Record<GuideKey, Record<string, boolean>> = { blue_tick: {}, bsp_migration: {} };
  for (const r of data ?? []) {
    const x = rec(r);
    const guide = x.guide as GuideKey;
    if (guide !== 'blue_tick' && guide !== 'bsp_migration') continue;
    out[guide][x.step_key as string] = x.done === true;
  }
  return out;
}

/**
 * Live account health from Meta. Returns null when no number is connected, and
 * an object carrying `error` when the Graph call failed — the page renders the
 * card either way rather than crashing on a missing token.
 */
export async function getWhatsAppAccountStatus(): Promise<
  (WhatsAppAccountStatus & { phoneNumberId: string }) | null
> {
  const creds = await getPrimaryWhatsAppCredentials();
  if (!creds) return null;
  if (!creds.token) {
    return {
      phoneNumberId: creds.phoneNumberId,
      displayPhoneNumber: null,
      verifiedName: null,
      qualityRating: 'UNKNOWN',
      messagingLimit: null,
      nameStatus: null,
      codeVerificationStatus: null,
      error: 'No access token stored for this number.',
    };
  }
  const status = await fetchWhatsAppAccountStatus(creds.token, creds.phoneNumberId);
  return { ...status, phoneNumberId: creds.phoneNumberId };
}
