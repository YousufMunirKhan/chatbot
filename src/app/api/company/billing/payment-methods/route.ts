import { NextResponse } from 'next/server';
import { env as publicEnv } from '@/lib/env';
import { handleApiError } from '@/lib/errors';
import { rateLimitDistributed } from '@/lib/ratelimit';
import {
  ensureStripeCustomer,
  getStripeCustomerIdentity,
  requireBillingAdminCompany,
} from '@/modules/company/billing-portal-data';
import { createCardSetupSession, getStripeKey } from '@/modules/company/billing-stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Start Stripe's hosted card-setup page, so a card can be saved for automatic
 * top-up without this application ever seeing it.
 *
 * This is what replaces the field that used to ask a customer to paste a `pm_…`
 * id. That id is an internal Stripe reference; the only way to obtain one is to
 * already be inside Stripe's dashboard or API, which no customer of this
 * product is. A SetupIntent — collected on Stripe's own page in `mode=setup`,
 * stored against the customer, marked for off-session use — produces the same
 * id legitimately, and produces it attached to the right customer, which a
 * typed value never guaranteed.
 *
 * NO CARD DETAIL TOUCHES THIS SERVER. The response is a URL; the card is
 * entered on stripe.com; what comes back is an identifier.
 */
export async function POST() {
  try {
    const companyId = await requireBillingAdminCompany();

    const limit = await rateLimitDistributed(`billing-card-setup:${companyId}`, 10, 60_000);
    if (!limit.ok) {
      return NextResponse.json(
        { error: 'Too many attempts to add a card. Wait a minute and try again.' },
        { status: 429 },
      );
    }

    const key = await getStripeKey();
    if (!key.ok) return NextResponse.json({ error: key.error }, { status: 400 });

    const identity = await getStripeCustomerIdentity(companyId);
    const customer = await ensureStripeCustomer({
      secretKey: key.data.secretKey,
      companyId,
      companyName: identity.name,
      email: identity.email,
    });
    if (!customer.ok) return NextResponse.json({ error: customer.error }, { status: 502 });

    const base = publicEnv.NEXT_PUBLIC_APP_URL;
    const session = await createCardSetupSession({
      secretKey: key.data.secretKey,
      customerId: customer.customerId,
      companyId,
      // Stripe substitutes the real id for the placeholder on redirect. The
      // return handler is what turns a saved card into the selected one, so
      // adding a card is one click rather than "now come back and pick it".
      successUrl: `${base}/api/company/billing/payment-methods/return?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${base}/company/billing?card=cancelled#auto-topup`,
    });
    if (!session.ok) {
      return NextResponse.json(
        { error: `Stripe could not open the card form: ${session.error}` },
        { status: 502 },
      );
    }

    return NextResponse.json({ url: session.data.url });
  } catch (err) {
    return handleApiError(err);
  }
}
