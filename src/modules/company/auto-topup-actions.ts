'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { maybeAutoTopUp } from '@/lib/billing/auto-topup';
import { getCompanyId } from './data';

/**
 * Company controls for automatic credit top-up (migration 0057).
 *
 * The payment method id is entered rather than collected here on purpose: this
 * app never handles card details, so the id has to come from a Stripe-hosted
 * setup flow (Billing Portal / SetupIntent). Saving it turns the feature on;
 * `src/lib/billing/auto-topup.ts` is what spends it.
 */

export type ActionState = { error?: string; ok?: boolean; message?: string };

const optText = z.preprocess((x) => (x === '' || x == null ? undefined : x), z.string().optional());

const settingsSchema = z.object({
  isEnabled: z.preprocess((x) => x === 'on', z.boolean()).default(false),
  // Credits are GBP in the ledger; the threshold is whole credits because
  // "top up when I drop under £5" is how a customer thinks about it.
  thresholdCredits: z.coerce.number().int().min(0, 'Threshold cannot be negative').max(10_000),
  // Stripe's minimum charge in GBP is 30p; below that every attempt fails.
  topupAmountCents: z.coerce
    .number()
    .int()
    .min(100, 'The top-up amount must be at least £1.00')
    .max(500_000, 'The top-up amount is too large'),
  stripePaymentMethodId: optText,
});

export async function saveAutoTopUpAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = settingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid settings' };
  const v = parsed.data;

  const paymentMethodId = v.stripePaymentMethodId?.trim() ?? null;
  if (v.isEnabled && !paymentMethodId) {
    return { error: 'Add a saved Stripe payment method id before turning auto top-up on.' };
  }
  if (paymentMethodId && !/^pm_[A-Za-z0-9_]+$/.test(paymentMethodId)) {
    return { error: 'A Stripe payment method id looks like "pm_1234…".' };
  }

  const sb = createSupabaseServiceClient();
  const { error } = await sb.from('company_auto_topup').upsert(
    {
      company_id: companyId,
      is_enabled: v.isEnabled,
      threshold_credits: v.thresholdCredits,
      topup_amount_cents: v.topupAmountCents,
      stripe_payment_method_id: paymentMethodId,
      // Saving is an explicit "try again": clear the failure streak that
      // switched the feature off, or the customer fixes their card and nothing
      // happens.
      failure_count: 0,
      disabled_reason: null,
      claimed_at: null,
    },
    { onConflict: 'company_id' },
  );
  if (error) return { error: error.message };

  revalidatePath('/company/billing');
  return { ok: true };
}

/**
 * Run the top-up check now.
 *
 * Also the only wired call site of `maybeAutoTopUp()` — everything else that
 * spends credit can call it, but nothing does implicitly, so a customer (and a
 * developer) can exercise the whole path on demand.
 */
export async function runAutoTopUpNowAction(
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const result = await maybeAutoTopUp(companyId);
  revalidatePath('/company/billing');
  if (result.status === 'charged') {
    return { ok: true, message: `Topped up £${((result.amountCents ?? 0) / 100).toFixed(2)}.` };
  }
  if (result.status === 'above_threshold') {
    return { ok: true, message: 'No top-up needed — your balance is above the threshold.' };
  }
  return { error: result.reason ?? 'Auto top-up did not run.' };
}
