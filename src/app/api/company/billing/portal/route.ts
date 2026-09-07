import { NextResponse } from 'next/server';
import { z } from 'zod';
import { env as publicEnv } from '@/lib/env';
import { handleApiError } from '@/lib/errors';
import { rateLimitDistributed } from '@/lib/ratelimit';
import {
  ensureStripeCustomer,
  getStripeCustomerIdentity,
  requireBillingAdminCompany,
} from '@/modules/company/billing-portal-data';
import { createPortalSession, getStripeKey, type PortalFlow } from '@/modules/company/billing-stripe';
import { createSupabaseServiceClient } from '@/lib/db/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Open Stripe's hosted billing portal for the company on the session.
 *
 * Everything this app used to lack — invoice history, changing a plan,
 * cancelling, adding or removing a card, updating the billing address and the
 * VAT number — is a page Stripe already runs, hardened, localised and PCI
 * compliant. Rebuilding any of it here would mean this server sitting in the
 * path of card data for no benefit, so it links out instead.
 *
 * `flow` deep-links into one task so the button the admin pressed matches the
 * screen they land on. The two subscription flows need a subscription id, which
 * is read from THIS company's row — never from the request — so the deep link
 * cannot be pointed at another tenant's subscription.
 */

const bodySchema = z.object({
  flow: z.enum(['payment_method_update', 'subscription_update', 'subscription_cancel']).optional(),
});

export async function POST(req: Request) {
  try {
    const companyId = await requireBillingAdminCompany();

    // A portal session is a Stripe object with a lifetime. Two admins with the
    // page open should not be able to mint them faster than they can read them.
    const limit = await rateLimitDistributed(`billing-portal:${companyId}`, 20, 60_000);
    if (!limit.ok) {
      return NextResponse.json(
        { error: 'Too many billing requests. Wait a minute and try again.' },
        { status: 429 },
      );
    }

    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'Unknown billing flow.' }, { status: 400 });

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

    const { data: row } = await createSupabaseServiceClient()
      .from('subscriptions')
      .select('stripe_subscription_id')
      .eq('company_id', companyId) // the isolation boundary — service client bypasses RLS
      .maybeSingle();
    const subscriptionId = (row as { stripe_subscription_id?: string | null } | null)?.stripe_subscription_id ?? null;

    const flow = parsed.data.flow as PortalFlow | undefined;
    const session = await createPortalSession({
      secretKey: key.data.secretKey,
      customerId: customer.customerId,
      returnUrl: `${publicEnv.NEXT_PUBLIC_APP_URL}/company/billing`,
      flow,
      subscriptionId,
    });

    if (!session.ok) {
      // Stripe's own words, kept intact. The commonest failure here is that
      // nobody has saved a portal configuration in the Stripe dashboard yet,
      // and "Stripe error" would send the admin to support with nothing to
      // forward.
      return NextResponse.json(
        { error: `Stripe could not open the billing portal: ${session.error}` },
        { status: 502 },
      );
    }

    return NextResponse.json({ url: session.data.url });
  } catch (err) {
    return handleApiError(err);
  }
}
