import { createSupabaseServiceClient } from '@/lib/db/server';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { queueAutomations } from './automations';
import {
  abandonThresholdMinutes,
  buildRecoveryLink,
  DEFAULT_ABANDON_MINUTES,
  isCartAbandoned,
  type AutomationEntity,
} from './automation-templates';

/**
 * Abandoned-cart recovery.
 *
 * A cart is "abandoned" when it is still open and nobody has touched it for the
 * threshold the company's own `cart_abandoned` rule specifies (default 60
 * minutes). Detection is separated from sending: this marks the cart and queues
 * a run, and the automation dispatcher does the messaging on its own schedule,
 * so a slow channel can never stall the scan.
 *
 * Carts created from a store checkout webhook and carts created in chat both
 * live in `chat_carts`, so one scan covers both surfaces.
 */

const MAX_CARTS_PER_COMPANY = 200;

export interface AbandonResult {
  companies: number;
  marked: number;
  queued: number;
}

interface CartRow {
  id: string;
  company_id: string;
  conversation_id: string | null;
  currency: string | null;
  subtotal: number | null;
  updated_at: string | null;
  metadata_json: Record<string, unknown> | null;
}

/** Re-export so callers only need one import for the link. */
export { buildRecoveryLink };

/** The recovery URL for one cart, preferring the store's own checkout link. */
export function cartRecoveryLink(cart: { id: string; metadata_json?: Record<string, unknown> | null }): string {
  const meta = cart.metadata_json ?? {};
  const checkoutUrl =
    (meta.recovery_url as string | undefined) ??
    (meta.abandoned_checkout_url as string | undefined) ??
    (meta.checkout_url as string | undefined) ??
    null;
  return buildRecoveryLink({ appUrl: env.NEXT_PUBLIC_APP_URL, cartId: cart.id, checkoutUrl });
}

/** Companies with at least one active cart_abandoned rule, and their threshold. */
async function companiesWithAbandonRules(companyId?: string): Promise<Map<string, number>> {
  const sb = createSupabaseServiceClient();
  let query = sb
    .from('automation_rules')
    .select('company_id,conditions_json')
    .eq('trigger_event', 'cart_abandoned')
    .eq('is_active', true)
    .limit(500);
  if (companyId) query = query.eq('company_id', companyId);

  const { data } = await query;
  const thresholds = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ company_id: string; conditions_json: unknown }>) {
    const minutes = abandonThresholdMinutes(row.conditions_json, DEFAULT_ABANDON_MINUTES);
    const current = thresholds.get(row.company_id);
    // Several rules can watch the same event; scan with the shortest window so
    // the earliest-firing rule is not starved by a slower sibling.
    if (current == null || minutes < current) thresholds.set(row.company_id, minutes);
  }
  return thresholds;
}

/** Contact details for a chat cart: the checkout payload first, then the lead. */
async function contactForCart(cart: CartRow): Promise<{ name: string | null; email: string | null; phone: string | null }> {
  const meta = cart.metadata_json ?? {};
  const fromMeta = {
    name: (meta.customer_name as string | undefined) ?? null,
    email: (meta.customer_email as string | undefined) ?? null,
    phone: (meta.customer_phone as string | undefined) ?? null,
  };
  if (fromMeta.email || fromMeta.phone) return fromMeta;
  if (!cart.conversation_id) return fromMeta;

  const sb = createSupabaseServiceClient();
  // TENANT ISOLATION: leads are looked up by company AND conversation.
  const { data } = await sb
    .from('leads')
    .select('name,email,phone')
    .eq('company_id', cart.company_id)
    .eq('conversation_id', cart.conversation_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const lead = (data ?? null) as { name: string | null; email: string | null; phone: string | null } | null;
  return {
    name: fromMeta.name ?? lead?.name ?? null,
    email: fromMeta.email ?? lead?.email ?? null,
    phone: fromMeta.phone ?? lead?.phone ?? null,
  };
}

async function cartItems(cart: CartRow): Promise<Array<{ title: string; quantity: number; price: number | null }>> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('chat_cart_items')
    .select('title,quantity,unit_price')
    .eq('company_id', cart.company_id)
    .eq('cart_id', cart.id)
    .limit(50);
  return ((data ?? []) as Array<{ title: string; quantity: number; unit_price: number | null }>).map((i) => ({
    title: i.title,
    quantity: Number(i.quantity ?? 1),
    price: i.unit_price == null ? null : Number(i.unit_price),
  }));
}

/**
 * Mark quiet carts as abandoned and queue their recovery message.
 * Pass a `companyId` to scan one tenant (used by tests and manual runs);
 * omit it and every company with an active rule is scanned.
 */
export async function detectAbandonedCarts(companyId?: string): Promise<AbandonResult> {
  const result: AbandonResult = { companies: 0, marked: 0, queued: 0 };
  const thresholds = await companiesWithAbandonRules(companyId);
  if (thresholds.size === 0) return result;

  const sb = createSupabaseServiceClient();
  const now = new Date();

  for (const [company, minutes] of thresholds) {
    result.companies += 1;
    const cutoff = new Date(now.getTime() - minutes * 60_000).toISOString();

    // MULTI-TENANT: company_id first, always.
    const { data } = await sb
      .from('chat_carts')
      .select('id,company_id,conversation_id,currency,subtotal,updated_at,metadata_json')
      .eq('company_id', company)
      .eq('status', 'open')
      .is('abandoned_at', null)
      .lte('updated_at', cutoff)
      .order('updated_at', { ascending: true })
      .limit(MAX_CARTS_PER_COMPANY);

    for (const row of (data ?? []) as CartRow[]) {
      // Re-check in JS as well: the query is the fast filter, this is the rule.
      if (!isCartAbandoned(row.updated_at, now, minutes)) continue;
      if (Number(row.subtotal ?? 0) <= 0) continue; // an empty cart is not a lost sale

      // Claim the cart before queueing so two overlapping cron runs cannot both
      // schedule it (the automation unique index is the second line of defence).
      const { data: claimed } = await sb
        .from('chat_carts')
        .update({ abandoned_at: now.toISOString() })
        .eq('company_id', company)
        .eq('id', row.id)
        .is('abandoned_at', null)
        .select('id')
        .maybeSingle();
      if (!claimed) continue;
      result.marked += 1;

      try {
        const contact = await contactForCart(row);
        const entity: AutomationEntity = {
          id: row.id,
          type: 'cart',
          orderNumber: null,
          customerName: contact.name,
          customerEmail: contact.email,
          customerPhone: contact.phone,
          total: row.subtotal == null ? null : Number(row.subtotal),
          currency: row.currency ?? 'USD',
          status: 'abandoned',
          recoveryUrl: cartRecoveryLink(row),
          items: await cartItems(row),
          updatedAt: row.updated_at,
        };
        const queued = await queueAutomations(company, 'cart_abandoned', entity);
        result.queued += queued.queued;
        if (queued.queued > 0) {
          await sb
            .from('chat_carts')
            .update({ recovery_sent_at: now.toISOString() })
            .eq('company_id', company)
            .eq('id', row.id);
        }
      } catch (err) {
        logger.warn('Abandoned cart queue failed', {
          companyId: company,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return result;
}

/** Called when a cart turns into an order — stops any further chasing. */
export async function markCartRecovered(companyId: string, cartId: string): Promise<void> {
  const sb = createSupabaseServiceClient();
  await sb
    .from('chat_carts')
    .update({ recovered_at: new Date().toISOString(), status: 'ordered' })
    .eq('company_id', companyId)
    .eq('id', cartId);
}
