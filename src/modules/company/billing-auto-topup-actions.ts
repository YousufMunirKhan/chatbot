'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from './data';
import { listStripeCards, getStripeKey } from './billing-stripe';

/**
 * Save automatic top-up, with the card chosen from the cards Stripe actually
 * holds for this company.
 *
 * WHAT CHANGED AND WHY
 * --------------------
 * The previous version of this form asked the customer to type a `pm_…` id.
 * That is an internal Stripe reference: the only people who can produce one are
 * people already inside a Stripe account, which is nobody who buys this
 * product. The field was a dead end wearing the costume of a feature.
 *
 * Now the card comes from `/api/company/billing/payment-methods`, which sends
 * the customer to Stripe's own hosted form, and the value submitted here is
 * picked from a list of cards read back from Stripe. This still never touches a
 * card number.
 *
 * WHY THE ID IS RE-CHECKED HERE
 * -----------------------------
 * A `<select>` is a suggestion, not a constraint — the value posted is whatever
 * the browser sends. Stripe would refuse a payment method that is not attached
 * to the customer we charge against, so the money cannot go astray either way,
 * but that refusal arrives days later as a failed top-up and a support ticket.
 * Checking at save time turns a silent future failure into an error message the
 * person is already reading.
 */

export type ActionState = { error?: string; ok?: boolean };

const schema = z.object({
  isEnabled: z.preprocess((x) => x === 'on', z.boolean()).default(false),
  // Credits are GBP in the ledger, and "top up when I drop under £5" is how a
  // customer thinks about the threshold, so it stays whole credits.
  thresholdCredits: z.coerce.number().int().min(0, 'The threshold cannot be negative').max(10_000),
  // Stripe's smallest GBP charge is 30p; anything under £1 is not worth the fee.
  topupAmountCents: z.coerce
    .number()
    .int()
    .min(100, 'The top-up amount must be at least £1.00')
    .max(500_000, 'The top-up amount is too large'),
  // '' means "no card selected", which is only valid while the feature is off.
  stripePaymentMethodId: z.string().trim().max(255).optional().default(''),
});

export async function saveBillingAutoTopUpAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid settings.' };
  const values = parsed.data;

  const sb = createSupabaseServiceClient();
  const { data: currentRow } = await sb
    .from('company_auto_topup')
    .select('stripe_payment_method_id')
    .eq('company_id', companyId) // the isolation boundary — service client bypasses RLS
    .maybeSingle();
  const currentCard =
    (currentRow as { stripe_payment_method_id?: string | null } | null)?.stripe_payment_method_id ?? null;

  const chosenCard = values.stripePaymentMethodId || null;

  if (values.isEnabled && !chosenCard) {
    return { error: 'Choose a card before turning automatic top-up on.' };
  }

  // Only a card that changed needs proving. Re-verifying the stored one on
  // every save would make a Stripe outage block an unrelated edit — someone
  // raising their threshold should not be stopped by a network blip.
  if (chosenCard && chosenCard !== currentCard) {
    const key = await getStripeKey();
    if (!key.ok) return { error: key.error };

    const { data: subRow } = await sb
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('company_id', companyId)
      .maybeSingle();
    const customerId =
      (subRow as { stripe_customer_id?: string | null } | null)?.stripe_customer_id ?? null;
    if (!customerId) {
      return { error: 'Add a card first — this account has no billing details on Stripe yet.' };
    }

    const cards = await listStripeCards(key.data.secretKey, customerId);
    if (!cards.ok) return { error: `Could not confirm that card with Stripe: ${cards.error}` };
    if (!cards.data.some((card) => card.id === chosenCard)) {
      return { error: 'That card is no longer saved on your account. Add it again and retry.' };
    }
  }

  const { error } = await sb.from('company_auto_topup').upsert(
    {
      company_id: companyId,
      is_enabled: values.isEnabled,
      threshold_credits: values.thresholdCredits,
      topup_amount_cents: values.topupAmountCents,
      stripe_payment_method_id: chosenCard,
      // Saving is an explicit "try this again": clear the failure streak that
      // switched the feature off, or a customer who fixes their card sees
      // nothing change.
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
