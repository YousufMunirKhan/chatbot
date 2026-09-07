'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES, SUPPORTED_LANGUAGES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { invalidateAgencyCache, normalizeBranding } from '@/lib/agency';
import { PLANS } from '@/modules/super-admin/plans';
import { getOwnedAgency } from './agency-data';
import { companyHasFeature } from '@/lib/entitlements';

/**
 * Agency-owner actions (migration 0057).
 *
 * ACCESS MODEL: `getOwnedAgency()` resolves the agency from the SESSION user,
 * so no form field names an agency and there is nothing for a caller to forge.
 * A company admin who owns no agency gets "not the owner" from every action
 * here, which is the same answer the page gives.
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

export async function updateAgencyBrandingAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  if (!(await companyHasFeature('agency'))) {
    return { error: 'Your plan does not include Agency sub-accounts. See Billing to change your package.' };
  }
  const agency = await getOwnedAgency();
  if (!agency) return { error: 'You do not own an agency.' };

  const parsed = brandingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid branding' };

  const branding = normalizeBranding(parsed.data);
  // A colour that failed validation silently becomes the platform blue, which
  // looks like the save was ignored. Say so instead.
  const submittedColor = parsed.data.primaryColor?.trim();
  if (submittedColor && branding.primaryColor !== submittedColor) {
    return { error: 'Enter the primary colour as a hex value, for example #2563eb.' };
  }

  const sb = createSupabaseServiceClient();
  const { error } = await sb
    .from('agencies')
    .update({ branding_json: branding })
    .eq('id', agency.id)
    // Belt and braces: the id came from the session, and this pins the write to
    // the owner as well.
    .eq('owner_user_id', agency.ownerUserId);
  if (error) return { error: error.message };

  invalidateAgencyCache();
  revalidatePath('/company/agency');
  revalidatePath('/company');
  return { ok: true };
}

const subAccountSchema = z.object({
  name: z.string().min(2, 'Business name is required').max(120),
  website: optText,
  defaultLanguage: z.enum(SUPPORTED_LANGUAGES).default('auto'),
  plan: z.enum(['free_trial', 'starter', 'growth', 'pro']).default('starter'),
});

/**
 * Create a company and attach it to the caller's agency, in that order.
 *
 * The company is deleted again if any later step fails: a half-created tenant
 * with no subscription row is worse than no tenant, because the billing
 * enforcement path reads `subscriptions` and would treat it as unlimited.
 */
export async function createSubAccountAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  if (!(await companyHasFeature('agency'))) {
    return { error: 'Your plan does not include Agency sub-accounts. See Billing to change your package.' };
  }
  const agency = await getOwnedAgency();
  if (!agency) return { error: 'You do not own an agency.' };
  if (!agency.isActive) return { error: 'This agency is deactivated. Contact platform support.' };

  const parsed = subAccountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid sub-account' };
  const v = parsed.data;
  const plan = PLANS[v.plan];

  const sb = createSupabaseServiceClient();
  const { data: company, error: companyError } = await sb
    .from('companies')
    .insert({
      name: v.name,
      slug: v.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50),
      website: v.website ?? null,
      default_language: v.defaultLanguage,
    })
    .select('id')
    .single();
  if (companyError || !company) return { error: companyError?.message ?? 'Could not create the account.' };

  const companyId = (company as { id: string }).id;
  const rollback = async (message: string): Promise<ActionState> => {
    await sb.from('companies').delete().eq('id', companyId);
    return { error: message };
  };

  const { error: subError } = await sb.from('subscriptions').insert({
    company_id: companyId,
    plan: v.plan,
    status: v.plan === 'free_trial' ? 'trialing' : 'active',
    message_limit: plan.messageLimit,
    bot_limit: plan.botLimit,
    agent_limit: plan.agentLimit,
    integration_limit: plan.integrationLimit,
  });
  if (subError) return rollback('Could not create the subscription: ' + subError.message);

  const { error: creditError } = await sb.from('company_credit_accounts').upsert({
    company_id: companyId,
    currency: 'GBP',
    balance_amount: plan.includedCreditGbp,
    lifetime_credit_added: plan.includedCreditGbp,
  });
  if (creditError) return rollback('Could not create the credit wallet: ' + creditError.message);

  const { error: linkError } = await sb
    .from('agency_companies')
    .insert({ agency_id: agency.id, company_id: companyId });
  if (linkError) return rollback('Could not attach the account to your agency: ' + linkError.message);

  invalidateAgencyCache();
  revalidatePath('/company/agency');
  return { ok: true };
}
