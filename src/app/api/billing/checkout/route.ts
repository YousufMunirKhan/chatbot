import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { getCompanyId } from '@/modules/company/data';
import { env as publicEnv } from '@/lib/env';
import { handleApiError } from '@/lib/errors';
import { getPlatformStripeSettings } from '@/lib/platform-settings';
import { getBillingPlan } from '@/modules/super-admin/billing-data';

export const runtime = 'nodejs';

/**
 * Create a Stripe Checkout Session for a plan (Module 19). The company admin is
 * redirected to Stripe; the webhook updates the subscription on completion.
 */
export async function POST(req: Request) {
  try {
    await requireRole([ROLES.COMPANY_ADMIN]);
    const companyId = await getCompanyId();
    const stripe = await getPlatformStripeSettings();
    if (!stripe.enabled || !stripe.secretKey) {
      return NextResponse.json({ error: 'Stripe is not configured.' }, { status: 400 });
    }
    const { plan } = (await req.json().catch(() => ({}))) as { plan?: string };
    if (!plan) return NextResponse.json({ error: 'plan required' }, { status: 400 });
    const billingPlan = await getBillingPlan(plan);
    if (!billingPlan?.isActive || !billingPlan.isPublic) {
      return NextResponse.json(
        { error: 'This plan is not available for checkout.' },
        { status: 400 },
      );
    }
    const sb = (await import('@/lib/db/server')).createSupabaseServiceClient();
    const { data: mapping } = await sb
      .from('stripe_price_mappings')
      .select('stripe_price_id,enabled')
      .eq('plan', plan)
      .eq('enabled', true)
      .maybeSingle();
    const priceId = mapping?.stripe_price_id as string | undefined;
    if (!priceId)
      return NextResponse.json(
        { error: 'This plan is not mapped to a Stripe price yet.' },
        { status: 400 },
      );

    const params = new URLSearchParams();
    params.set('mode', 'subscription');
    params.set('line_items[0][price]', priceId);
    params.set('line_items[0][quantity]', '1');
    params.set('client_reference_id', companyId);
    params.set('metadata[plan]', plan);
    params.set(
      'metadata[message_limit]',
      billingPlan.messageLimit == null ? '' : String(billingPlan.messageLimit),
    );
    params.set('success_url', `${publicEnv.NEXT_PUBLIC_APP_URL}/company/billing?status=success`);
    params.set('cancel_url', `${publicEnv.NEXT_PUBLIC_APP_URL}/company/billing?status=cancel`);

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripe.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    if (!res.ok) return NextResponse.json({ error: 'Stripe error' }, { status: 502 });
    const session = await res.json();
    return NextResponse.json({ url: session.url });
  } catch (err) {
    return handleApiError(err);
  }
}
