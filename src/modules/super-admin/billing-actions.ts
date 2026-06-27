'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';

const schema = z.object({
  plan: z.string().min(2),
  stripePriceId: z.string().min(3),
  overagePriceId: z.preprocess(
    (x) => (x === '' || x == null ? undefined : x),
    z.string().optional(),
  ),
  enabled: z.preprocess((x) => x === 'on', z.boolean()),
});

export type BillingMapState = { error?: string; ok?: boolean };

export async function saveStripePriceMappingAction(
  _prev: BillingMapState,
  formData: FormData,
): Promise<BillingMapState> {
  const admin = await requireRole([ROLES.SUPER_ADMIN]);
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const v = parsed.data;
  const { error } = await createSupabaseServiceClient()
    .from('stripe_price_mappings')
    .upsert(
      {
        plan: v.plan,
        stripe_price_id: v.stripePriceId,
        overage_price_id: v.overagePriceId ?? null,
        enabled: v.enabled,
        updated_by: admin.userId,
      },
      { onConflict: 'plan' },
    );
  if (error) return { error: error.message };
  revalidatePath('/super-admin/billing');
  return { ok: true };
}

const optInt = z.preprocess(
  (x) => (x === '' || x == null ? undefined : x),
  z.coerce.number().int().nonnegative().optional(),
);
const optMoney = z.preprocess(
  (x) => (x === '' || x == null ? undefined : x),
  z.coerce.number().nonnegative().optional(),
);

function slugifyPlanKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

const planSchema = z.object({
  key: z.string().optional(),
  label: z.string().min(2, 'Plan name is required'),
  description: z.string().optional(),
  priceMonthlyGbp: z.coerce.number().nonnegative(),
  messageLimit: optInt,
  botLimit: optInt,
  agentLimit: optInt,
  integrationLimit: optInt,
  includedCreditGbp: optMoney,
  trialDays: optInt,
  sortOrder: z.coerce.number().int().default(100),
  isPublic: z.preprocess((x) => x === 'on', z.boolean()).default(false),
  isActive: z.preprocess((x) => x === 'on', z.boolean()).default(false),
});

export async function saveBillingPlanAction(
  _prev: BillingMapState,
  formData: FormData,
): Promise<BillingMapState> {
  const admin = await requireRole([ROLES.SUPER_ADMIN]);
  const parsed = planSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const v = parsed.data;
  const key = v.key?.trim() || slugifyPlanKey(v.label);
  if (!key) return { error: 'Plan key could not be generated.' };

  const { error } = await createSupabaseServiceClient()
    .from('billing_plans')
    .upsert(
      {
        key,
        label: v.label,
        description: v.description ?? '',
        price_monthly_gbp: v.priceMonthlyGbp,
        message_limit: v.messageLimit ?? null,
        bot_limit: v.botLimit ?? null,
        agent_limit: v.agentLimit ?? null,
        integration_limit: v.integrationLimit ?? null,
        included_credit_gbp: v.includedCreditGbp ?? 0,
        trial_days: v.trialDays ?? null,
        is_public: v.isPublic,
        is_active: v.isActive,
        sort_order: v.sortOrder,
        updated_by: admin.userId,
        created_by: admin.userId,
      },
      { onConflict: 'key' },
    );
  if (error) return { error: error.message };
  revalidatePath('/super-admin/billing');
  revalidatePath('/company/billing');
  return { ok: true };
}
