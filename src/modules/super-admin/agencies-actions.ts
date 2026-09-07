'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { invalidateAgencyCache, normalizeBranding, slugifyAgency } from '@/lib/agency';

/**
 * Super-admin management of white-label agencies (migration 0057).
 *
 * Every write here ends with `invalidateAgencyCache()`: `src/lib/agency.ts`
 * memoises branding for a minute, and a super admin who saves a logo and then
 * reloads to see the old one would reasonably conclude the save failed.
 */

export type ActionState = { error?: string; ok?: boolean };

const optText = z.preprocess((x) => (x === '' || x == null ? undefined : x), z.string().optional());

const brandingSchema = z.object({
  productName: optText,
  logoUrl: optText,
  primaryColor: optText,
  supportEmail: optText,
  hidePoweredBy: z.preprocess((x) => x === 'on', z.boolean()).default(false),
  loginBackground: optText,
});

const createSchema = z
  .object({
    name: z.string().min(2, 'Name is required').max(120),
    slug: optText,
    ownerEmail: optText,
    customDomain: optText,
  })
  .merge(brandingSchema);

/** Look up an existing platform user by email. Never creates one. */
async function resolveOwnerId(email: string | undefined): Promise<
  { ok: true; id: string | null } | { ok: false; error: string }
> {
  if (!email) return { ok: true, id: null };
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('users')
    .select('id')
    .eq('email', email.trim().toLowerCase())
    .maybeSingle();
  if (!data) {
    return {
      ok: false,
      error: 'No user with that email. Invite them to the platform first, then set them as owner.',
    };
  }
  return { ok: true, id: (data as { id: string }).id };
}

export async function createAgencyAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole([ROLES.SUPER_ADMIN]);
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid agency' };
  const v = parsed.data;

  const slug = slugifyAgency(v.slug ?? v.name);
  if (!slug) return { error: 'Could not build a slug from that name.' };

  const owner = await resolveOwnerId(v.ownerEmail);
  if (!owner.ok) return { error: owner.error };

  const sb = createSupabaseServiceClient();
  const { error } = await sb.from('agencies').insert({
    name: v.name,
    slug,
    owner_user_id: owner.id,
    custom_domain: v.customDomain?.trim().toLowerCase() ?? null,
    branding_json: normalizeBranding(v),
    is_active: true,
  });
  if (error) {
    return {
      error: error.message.includes('duplicate')
        ? 'That slug or domain is already used by another agency.'
        : error.message,
    };
  }

  invalidateAgencyCache();
  revalidatePath('/super-admin/agencies');
  return { ok: true };
}

const updateSchema = z
  .object({
    agencyId: z.string().uuid(),
    name: z.string().min(2).max(120),
    ownerEmail: optText,
    customDomain: optText,
  })
  .merge(brandingSchema);

export async function updateAgencyAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole([ROLES.SUPER_ADMIN]);
  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid agency' };
  const v = parsed.data;

  const owner = await resolveOwnerId(v.ownerEmail);
  if (!owner.ok) return { error: owner.error };

  const sb = createSupabaseServiceClient();
  const { error } = await sb
    .from('agencies')
    .update({
      name: v.name,
      owner_user_id: owner.id,
      custom_domain: v.customDomain?.trim().toLowerCase() ?? null,
      branding_json: normalizeBranding(v),
    })
    .eq('id', v.agencyId);
  if (error) return { error: error.message };

  invalidateAgencyCache();
  revalidatePath('/super-admin/agencies');
  revalidatePath('/company/agency');
  return { ok: true };
}

export async function toggleAgencyAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.SUPER_ADMIN]);
  const id = z.string().uuid().safeParse(formData.get('agencyId'));
  if (!id.success) return;
  const active = formData.get('active') === 'true';
  const sb = createSupabaseServiceClient();
  await sb.from('agencies').update({ is_active: active }).eq('id', id.data);
  invalidateAgencyCache();
  revalidatePath('/super-admin/agencies');
}

export async function attachCompanyAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.SUPER_ADMIN]);
  const agencyId = z.string().uuid().safeParse(formData.get('agencyId'));
  const companyId = z.string().uuid().safeParse(formData.get('companyId'));
  if (!agencyId.success || !companyId.success) return;
  const sb = createSupabaseServiceClient();
  // `unique(company_id)` on the table is what enforces "one agency per
  // company"; a second attach fails here rather than silently re-homing a
  // tenant, which would change what its users see on the next page load.
  await sb
    .from('agency_companies')
    .insert({ agency_id: agencyId.data, company_id: companyId.data });
  invalidateAgencyCache();
  revalidatePath('/super-admin/agencies');
}

export async function detachCompanyAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.SUPER_ADMIN]);
  const agencyId = z.string().uuid().safeParse(formData.get('agencyId'));
  const companyId = z.string().uuid().safeParse(formData.get('companyId'));
  if (!agencyId.success || !companyId.success) return;
  const sb = createSupabaseServiceClient();
  await sb
    .from('agency_companies')
    .delete()
    .eq('agency_id', agencyId.data)
    .eq('company_id', companyId.data);
  invalidateAgencyCache();
  revalidatePath('/super-admin/agencies');
}
