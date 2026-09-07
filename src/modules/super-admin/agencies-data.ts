import { createSupabaseServiceClient } from '@/lib/db/server';
import { normalizeBranding, type AgencyBranding } from '@/lib/agency';

/**
 * Super-admin view of white-label agencies (migration 0057).
 *
 * Reads with the service client because this is platform-wide data — an agency
 * row belongs to no single tenant. Every caller is behind
 * `requireRole([ROLES.SUPER_ADMIN])`.
 */

export interface AgencyListRow {
  id: string;
  name: string;
  slug: string;
  ownerUserId: string | null;
  ownerEmail: string | null;
  customDomain: string | null;
  isActive: boolean;
  branding: AgencyBranding;
  companyCount: number;
  createdAt: string;
}

export interface AgencyCompanyRow {
  companyId: string;
  companyName: string;
  agencyId: string;
  attachedAt: string;
}

export async function listAgencies(): Promise<AgencyListRow[]> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('agencies')
    .select('id,name,slug,owner_user_id,branding_json,custom_domain,is_active,created_at, users(email)')
    .order('created_at', { ascending: false })
    .limit(200);

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return [];

  // One extra query for the attachment counts rather than N — the list page is
  // read on every super-admin visit to /super-admin/agencies.
  const { data: links } = await sb
    .from('agency_companies')
    .select('agency_id')
    .in(
      'agency_id',
      rows.map((r) => r.id as string),
    );
  const counts = new Map<string, number>();
  for (const link of (links ?? []) as Array<{ agency_id: string }>) {
    counts.set(link.agency_id, (counts.get(link.agency_id) ?? 0) + 1);
  }

  return rows.map((r) => {
    const owner = r.users as { email?: string } | { email?: string }[] | null;
    const ownerRow = Array.isArray(owner) ? (owner[0] ?? null) : owner;
    return {
      id: r.id as string,
      name: r.name as string,
      slug: r.slug as string,
      ownerUserId: (r.owner_user_id as string) ?? null,
      ownerEmail: ownerRow?.email ?? null,
      customDomain: (r.custom_domain as string) ?? null,
      isActive: r.is_active !== false,
      branding: normalizeBranding(r.branding_json),
      companyCount: counts.get(r.id as string) ?? 0,
      createdAt: r.created_at as string,
    };
  });
}

/** Every company attachment, so the page can show who belongs where. */
export async function listAgencyCompanies(): Promise<AgencyCompanyRow[]> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('agency_companies')
    .select('agency_id,company_id,created_at, companies(name)')
    .order('created_at', { ascending: false })
    .limit(500);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const embedded = r.companies as { name?: string } | { name?: string }[] | null;
    const company = Array.isArray(embedded) ? (embedded[0] ?? null) : embedded;
    return {
      companyId: r.company_id as string,
      companyName: company?.name ?? 'Unknown company',
      agencyId: r.agency_id as string,
      attachedAt: r.created_at as string,
    };
  });
}

/** Companies not yet attached to any agency — the attach dropdown's options. */
export async function listUnattachedCompanies(): Promise<Array<{ id: string; name: string }>> {
  const sb = createSupabaseServiceClient();
  const [{ data: companies }, { data: links }] = await Promise.all([
    sb.from('companies').select('id,name').order('name', { ascending: true }).limit(500),
    sb.from('agency_companies').select('company_id').limit(1000),
  ]);
  const taken = new Set((links ?? []).map((l) => (l as { company_id: string }).company_id));
  return ((companies ?? []) as Array<{ id: string; name: string }>).filter((c) => !taken.has(c.id));
}
