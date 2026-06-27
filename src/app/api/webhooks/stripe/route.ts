import Stripe from 'stripe';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { notify } from '@/lib/notify';
import { logger } from '@/lib/logger';
import { getPlatformStripeSettings } from '@/lib/platform-settings';
import { getBillingPlan } from '@/modules/super-admin/billing-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function parseStripeEvent(req: Request): Promise<Stripe.Event> {
  const settings = await getPlatformStripeSettings();
  const body = await req.text();
  if (settings.webhookSecret && settings.secretKey) {
    const signature = req.headers.get('stripe-signature');
    if (!signature) throw new Error('Missing Stripe signature.');
    const stripe = new Stripe(settings.secretKey);
    return stripe.webhooks.constructEvent(body, signature, settings.webhookSecret);
  }
  logger.warn(
    'Stripe webhook signature verification is disabled; set stripe.webhook_secret before production.',
  );
  return JSON.parse(body) as Stripe.Event;
}

export async function POST(req: Request) {
  let event: Stripe.Event;
  try {
    event = await parseStripeEvent(req);
  } catch (err) {
    logger.warn('Stripe webhook verification failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return new Response('bad request', { status: 400 });
  }

  const sb = createSupabaseServiceClient();
  const obj = event.data.object as unknown as Record<string, unknown>;

  try {
    if (event.type === 'checkout.session.completed') {
      const companyId = obj.client_reference_id as string | undefined;
      const metadata = (obj.metadata as { plan?: string } | undefined) ?? {};
      const planKey = metadata.plan;
      const plan = planKey ? await getBillingPlan(planKey) : null;
      if (companyId && planKey && plan) {
        await sb
          .from('subscriptions')
          .update({
            status: 'active',
            plan: planKey,
            free_until: null,
            message_limit: plan.messageLimit,
            bot_limit: plan.botLimit,
            agent_limit: plan.agentLimit,
            integration_limit: plan.integrationLimit,
            stripe_customer_id: (obj.customer as string) ?? null,
            stripe_subscription_id: (obj.subscription as string) ?? null,
          })
          .eq('company_id', companyId);
      }
    } else if (
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'
    ) {
      const subId = obj.id as string | undefined;
      const status = event.type.endsWith('deleted')
        ? 'canceled'
        : ((obj.status as string) ?? 'active');
      if (subId) {
        await sb.from('subscriptions').update({ status }).eq('stripe_subscription_id', subId);
      }
    } else if (event.type === 'invoice.payment_failed') {
      const customer = obj.customer as string | undefined;
      if (customer) {
        const { data } = await sb
          .from('subscriptions')
          .update({ status: 'past_due' })
          .eq('stripe_customer_id', customer)
          .select('company_id')
          .maybeSingle();
        if (data?.company_id) {
          await notify({
            companyId: data.company_id as string,
            type: 'failed_payment',
            title: 'Payment failed',
            body: 'Your latest subscription payment failed. Please update your payment method.',
            email: true,
          });
        }
      }
    }
  } catch (err) {
    logger.error('Stripe webhook error', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return new Response('ok', { status: 200 });
}
