import { createSupabaseServiceClient } from '@/lib/db/server';
import { logger } from '@/lib/logger';

/**
 * Agency / white-label mode (migration 0057).
 *
 * A reseller ("agency") owns a set of sub-account companies and re-brands the
 * product for them. Everything cosmetic lives in one `branding_json` blob so a
 * new knob never costs a migration; this file is the only reader, and
 * `normalizeBranding()` is the only place that decides what a missing or junk
 * value falls back to.
 *
 * PERFORMANCE: `resolveBranding()` is called from the dashboard shell, i.e. on
 * every page render. Two uncached queries there would be two queries on every
 * navigation for the ~99% of tenants that have no agency at all, so lookups are
 * memoised in-process for a short TTL — including the negative result, which is
 * the common case. The TTL is deliberately short (a minute): branding is edited
 * by hand, and a stale logo for under a minute is cheaper than a permanent
 * cache that needs invalidating from three different call sites.
 */

export interface AgencyBranding {
  productName: string;
  /** Absolute or app-relative URL. `null` means "use the platform logo". */
  logoUrl: string | null;
  /** `#rrggbb`. Validated, because it is interpolated into inline styles. */
  primaryColor: string;
  supportEmail: string | null;
  /** Hide the "Powered by …" line in the chat widget and dashboard footer. */
  hidePoweredBy: boolean;
  /** Image URL for the login page's brand panel. */
  loginBackground: string | null;
}

export interface Agency {
  id: string;
  name: string;
  slug: string;
  ownerUserId: string | null;
  customDomain: string | null;
  isActive: boolean;
  branding: AgencyBranding;
  createdAt: string;
}

/** What every tenant without an agency sees — the platform's own identity. */
export const DEFAULT_BRANDING: AgencyBranding = {
  productName: 'Switch & Save',
  logoUrl: null,
  primaryColor: '#2563eb',
  supportEmail: null,
  hidePoweredBy: false,
  loginBackground: null,
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function str(value: unknown, max = 200): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/**
 * Turn whatever is in `branding_json` into a complete, safe `AgencyBranding`.
 *
 * Pure and total: any shape of input (null, a string, a half-filled object,
 * a colour with a `javascript:` URL in it) yields every field populated, with
 * the platform default standing in for anything unusable.
 */
export function normalizeBranding(raw: unknown): AgencyBranding {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const color = str(source.primaryColor, 7);
  // Only http(s) and app-relative paths. A logo URL is rendered into `src`, so
  // `javascript:`/`data:` values are dropped rather than sanitised.
  const url = (value: unknown): string | null => {
    const s = str(value, 500);
    if (!s) return null;
    return /^(https?:\/\/|\/)/.test(s) ? s : null;
  };
  return {
    productName: str(source.productName, 80) ?? DEFAULT_BRANDING.productName,
    logoUrl: url(source.logoUrl),
    primaryColor: color && HEX_COLOR.test(color) ? color : DEFAULT_BRANDING.primaryColor,
    supportEmail: str(source.supportEmail, 200),
    hidePoweredBy: source.hidePoweredBy === true,
    loginBackground: url(source.loginBackground),
  };
}

/** Lowercased host with the port and a leading `www.` removed. */
export function normalizeHost(host: string | null | undefined): string | null {
  if (!host) return null;
  const bare = host.trim().toLowerCase().split(',')[0]?.trim() ?? '';
  const noPort = bare.replace(/:\d+$/, '');
  const noWww = noPort.replace(/^www\./, '');
  return noWww || null;
}

function toAgency(row: Record<string, unknown>): Agency {
  return {
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    ownerUserId: (row.owner_user_id as string) ?? null,
    customDomain: (row.custom_domain as string) ?? null,
    isActive: row.is_active !== false,
    branding: normalizeBranding(row.branding_json),
    createdAt: row.created_at as string,
  };
}

// --- in-process cache -------------------------------------------------------

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { value: Agency | null; expiresAt: number }>();

/** Drop memoised lookups so an edit in the UI shows up immediately. */
export function invalidateAgencyCache(): void {
  cache.clear();
}

async function cached(key: string, load: () => Promise<Agency | null>): Promise<Agency | null> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;
  let value: Agency | null = null;
  try {
    value = await load();
  } catch (err) {
    // Branding must never take a page down. Cache nothing on failure so the
    // next render retries instead of serving defaults for a whole minute.
    logger.warn('Agency lookup failed', {
      key,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
  cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

// --- readers ----------------------------------------------------------------

/** The active agency a company is a sub-account of, or `null`. */
export async function getAgencyForCompany(companyId: string): Promise<Agency | null> {
  if (!companyId) return null;
  return cached(`company:${companyId}`, async () => {
    const sb = createSupabaseServiceClient();
    const { data: link } = await sb
      .from('agency_companies')
      .select('agency_id')
      .eq('company_id', companyId)
      .maybeSingle();
    const agencyId = (link as { agency_id?: string } | null)?.agency_id;
    if (!agencyId) return null;
    const { data } = await sb
      .from('agencies')
      .select('id,name,slug,owner_user_id,branding_json,custom_domain,is_active,created_at')
      .eq('id', agencyId)
      .eq('is_active', true)
      .maybeSingle();
    return data ? toAgency(data as Record<string, unknown>) : null;
  });
}

/** The active agency serving a hostname (custom-domain white-labelling). */
export async function getAgencyByDomain(host: string | null | undefined): Promise<Agency | null> {
  const domain = normalizeHost(host);
  if (!domain) return null;
  return cached(`domain:${domain}`, async () => {
    const sb = createSupabaseServiceClient();
    const { data } = await sb
      .from('agencies')
      .select('id,name,slug,owner_user_id,branding_json,custom_domain,is_active,created_at')
      .eq('custom_domain', domain)
      .eq('is_active', true)
      .maybeSingle();
    return data ? toAgency(data as Record<string, unknown>) : null;
  });
}

/** The agency an operator owns, if any. Gates `/company/agency`. */
export async function getAgencyForOwner(userId: string): Promise<Agency | null> {
  if (!userId) return null;
  return cached(`owner:${userId}`, async () => {
    const sb = createSupabaseServiceClient();
    const { data } = await sb
      .from('agencies')
      .select('id,name,slug,owner_user_id,branding_json,custom_domain,is_active,created_at')
      .eq('owner_user_id', userId)
      .maybeSingle();
    return data ? toAgency(data as Record<string, unknown>) : null;
  });
}

/**
 * Branding for a company — the agency's when it has one, the platform's
 * otherwise. Never throws and never returns a partial object.
 */
export async function resolveBranding(companyId: string | null | undefined): Promise<AgencyBranding> {
  if (!companyId) return DEFAULT_BRANDING;
  const agency = await getAgencyForCompany(companyId);
  return agency ? agency.branding : DEFAULT_BRANDING;
}

/**
 * URL-safe slug for an agency.
 *
 * Lives here rather than in the server-action module: a file marked
 * `'use server'` may only export async functions, so a synchronous helper next
 * to the actions breaks the build.
 */
export function slugifyAgency(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}
