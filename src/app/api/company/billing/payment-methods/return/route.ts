import { NextResponse } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { env as publicEnv } from '@/lib/env';
import { logger } from '@/lib/logger';
import { requireBillingAdminCompany } from '@/modules/company/billing-portal-data';
import { getCardSetupSession, getStripeKey } from '@/modules/company/billing-stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Where Stripe sends the browser after a card has been saved.
 *
 * The customer clicked "Use a card for top-ups", entered it on Stripe, and is
 * now back. This reads the finished setup session, takes the payment method it
 * produced, and writes it into the company's auto top-up settings — so adding a
 * card is one action, not "add it, come back, find it in a list, save".
 *
 * WHY THE CHECKS ARE NOT OPTIONAL
 * -------------------------------
 * `session_id` arrives in a URL the browser can be pointed at, so it is a value
 * an attacker chooses. Two things make it safe: the caller must be a company
 * admin, and the Stripe customer on the session must equal the customer stored
 * on THIS company's subscription row. Without the second check, a signed-in
 * admin of company A who obtained a session id belonging to company B could
 * write B's payment method into A's settings and have A's balance charged
 * against B's card. The company id also has to agree, which the setup session
 * carries in its own metadata.
 *
 * Every outcome is a redirect back to the billing page with a short reason, so
 * the customer always lands somewhere that explains itself.
 */

type Outcome = 'saved' | 'failed' | 'mismatch' | 'incomplete' | 'unavailable';

function back(outcome: Outcome): NextResponse {
  return NextResponse.redirect(
    `${publicEnv.NEXT_PUBLIC_APP_URL}/company/billing?card=${outcome}#auto-topup`,
    { status: 303 },
  );
}

export async function GET(req: Request) {
  let companyId: string;
  try {
    companyId = await requireBillingAdminCompany();
  } catch {
    // A signed-out or wrong-role visitor gets the login redirect the dashboard
    // already does, rather than a JSON error in the address bar.
    return NextResponse.redirect(`${publicEnv.NEXT_PUBLIC_APP_URL}/login`, { status: 303 });
  }

  const sessionId = new URL(req.url).searchParams.get('session_id');
  if (!sessionId) return back('failed');

  const key = await getStripeKey();
  if (!key.ok) return back('unavailable');

  const sb = createSupabaseServiceClient();
  const { data: subRow } = await sb
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('company_id', companyId) // the isolation boundary — service client bypasses RLS
    .maybeSingle();
  const ourCustomer = (subRow as { stripe_customer_id?: string | null } | null)?.stripe_customer_id ?? null;
  // The POST that started this flow stores the customer before sending anyone
  // to Stripe, so an empty column here means that write was lost — not that
  // somebody is replaying another tenant's session id.
  if (!ourCustomer) return back('failed');

  const session = await getCardSetupSession(key.data.secretKey, sessionId);
  if (!session.ok) return back('failed');

  const { customerId, companyId: sessionCompanyId, paymentMethodId, status } = session.data;

  if (customerId !== ourCustomer || sessionCompanyId !== companyId) {
    logger.warn('Card setup session did not belong to this company', {
      companyId,
      module: 'company/billing',
    });
    return back('mismatch');
  }
  if (status !== 'complete' || !paymentMethodId) return back('incomplete');

  // Upsert rather than update: a company that has never opened the top-up form
  // has no row yet, and the table's own defaults supply the threshold and the
  // amount. `is_enabled` is deliberately absent — saving a card is consent to
  // store it, not consent to start charging it on a schedule. The customer
  // turns that on themselves, with the amount in front of them.
  const { error } = await sb.from('company_auto_topup').upsert(
    {
      company_id: companyId,
      stripe_payment_method_id: paymentMethodId,
      // A new card is an explicit second attempt, so the failure streak that
      // switched the feature off is cleared with it — otherwise the customer
      // fixes their card and the next run still refuses.
      failure_count: 0,
      disabled_reason: null,
      claimed_at: null,
    },
    { onConflict: 'company_id' },
  );
  if (error) {
    logger.error('Saved a card at Stripe but could not store it', {
      companyId,
      error: error.message,
      module: 'company/billing',
    });
    return back('failed');
  }

  return back('saved');
}
