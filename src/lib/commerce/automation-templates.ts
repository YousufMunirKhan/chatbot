/**
 * Pure automation logic — no database, no network, no Node built-ins.
 *
 * Everything the e-commerce automations decide (does this rule match? what does
 * the message say? which event is this webhook? is this cart abandoned yet?)
 * lives here so it can be unit-tested offline (`scripts/test-automations.mjs`)
 * and so the DB-facing modules stay thin. Deliberately isomorphic: the rule
 * form is a client component and imports the event list and placeholder names
 * from here, so nothing in this file may reach for `crypto` or `fs`
 * (signature verification lives in `./store-signatures`).
 */

export const AUTOMATION_EVENTS = [
  'order_created',
  'order_paid',
  'order_shipped',
  'order_delivered',
  'order_cancelled',
  'order_refunded',
  'cart_abandoned',
  'customer_created',
] as const;
export type AutomationEvent = (typeof AUTOMATION_EVENTS)[number];

export function isAutomationEvent(value: string): value is AutomationEvent {
  return (AUTOMATION_EVENTS as readonly string[]).includes(value);
}

export const EVENT_LABELS: Record<AutomationEvent, string> = {
  order_created: 'Order placed',
  order_paid: 'Order paid',
  order_shipped: 'Order shipped',
  order_delivered: 'Order delivered',
  order_cancelled: 'Order cancelled',
  order_refunded: 'Order refunded',
  cart_abandoned: 'Cart abandoned',
  customer_created: 'New customer',
};

export type AutomationEntityType = 'order' | 'cart' | 'customer';

/**
 * The normalised thing an automation is about. Shopify orders, WooCommerce
 * orders, chat carts and synced customers are all flattened to this shape
 * before any rule sees them, so a rule never has to know which store it came
 * from.
 */
export interface AutomationEntity {
  /** Stable id used for the (rule, entity) uniqueness guarantee. */
  id: string;
  type: AutomationEntityType;
  orderNumber?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  total?: number | null;
  currency?: string | null;
  status?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  recoveryUrl?: string | null;
  items?: Array<{ title?: string | null; quantity?: number | null; price?: number | null }>;
  /** Last customer touch — abandonment is measured from this. */
  updatedAt?: string | null;
}

// --- Template rendering -----------------------------------------------------

export const TEMPLATE_PLACEHOLDERS = [
  'order_number',
  'customer_name',
  'total',
  'currency',
  'status',
  'tracking_number',
  'tracking_url',
  'recovery_url',
  'items',
] as const;

function formatMoney(total: number | null | undefined, currency: string | null | undefined): string {
  if (total == null || !Number.isFinite(Number(total))) return '';
  const amount = Number(total).toFixed(2);
  return currency ? `${amount} ${currency}` : amount;
}

function formatItems(entity: AutomationEntity): string {
  const items = entity.items ?? [];
  return items
    .map((i) => {
      const qty = Number(i.quantity ?? 1);
      const title = (i.title ?? '').trim() || 'Item';
      return qty > 1 ? `${qty}x ${title}` : title;
    })
    .filter(Boolean)
    .join(', ');
}

/** The `{{placeholder}}` values available to a message template. */
export function templateVars(entity: AutomationEntity): Record<string, string> {
  return {
    order_number: (entity.orderNumber ?? '').trim(),
    customer_name: (entity.customerName ?? '').trim(),
    total: formatMoney(entity.total, entity.currency),
    currency: (entity.currency ?? '').trim(),
    status: (entity.status ?? '').trim(),
    tracking_number: (entity.trackingNumber ?? '').trim(),
    tracking_url: (entity.trackingUrl ?? '').trim(),
    recovery_url: (entity.recoveryUrl ?? '').trim(),
    items: formatItems(entity),
  };
}

/**
 * Substitute `{{placeholder}}` tokens. Whitespace inside the braces is allowed;
 * an unknown or empty placeholder collapses to nothing rather than leaking the
 * raw token to a customer, and the leftover double spaces are tidied up.
 */
export function renderTemplate(template: string, entity: AutomationEntity): string {
  const vars = templateVars(entity);
  const filled = (template ?? '').replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_m, key: string) => {
    const value = vars[key.toLowerCase()];
    return value == null ? '' : value;
  });
  return filled
    .split('\n')
    .map((line) => line.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim();
}

// --- Condition evaluation ---------------------------------------------------

export interface AutomationConditions {
  /** Only fire at or above this order total. */
  minTotal?: number;
  /** Only fire at or below this order total. */
  maxTotal?: number;
  /** Restrict to one currency, or any of several. */
  currency?: string | string[];
  /** Restrict to a provider status (`paid`, `completed`, `refunded`, …). */
  status?: string | string[];
  /** Refuse to queue unless we have a way to reach the customer. */
  requireEmail?: boolean;
  requirePhone?: boolean;
  /** `cart_abandoned` only — how quiet a cart must be before it counts. */
  abandonAfterMinutes?: number;
  /** Escape hatch: every clause must hold. */
  all?: Array<{ field: string; op?: string; value?: unknown }>;
}

function asArray(value: string | string[] | undefined): string[] {
  if (value == null) return [];
  return (Array.isArray(value) ? value : [value]).map((v) => String(v).toLowerCase().trim()).filter(Boolean);
}

function fieldValue(entity: AutomationEntity, field: string): unknown {
  const map: Record<string, unknown> = {
    total: entity.total,
    currency: entity.currency,
    status: entity.status,
    order_number: entity.orderNumber,
    customer_email: entity.customerEmail,
    customer_phone: entity.customerPhone,
    customer_name: entity.customerName,
    tracking_url: entity.trackingUrl,
    item_count: (entity.items ?? []).length,
  };
  return map[field.toLowerCase()];
}

function compare(actual: unknown, op: string, expected: unknown): boolean {
  const numA = Number(actual);
  const numB = Number(expected);
  const strA = actual == null ? '' : String(actual).toLowerCase();
  const strB = expected == null ? '' : String(expected).toLowerCase();
  switch (op) {
    case 'gt':
      return Number.isFinite(numA) && Number.isFinite(numB) && numA > numB;
    case 'gte':
      return Number.isFinite(numA) && Number.isFinite(numB) && numA >= numB;
    case 'lt':
      return Number.isFinite(numA) && Number.isFinite(numB) && numA < numB;
    case 'lte':
      return Number.isFinite(numA) && Number.isFinite(numB) && numA <= numB;
    case 'ne':
      return strA !== strB;
    case 'contains':
      return strA.includes(strB);
    case 'in':
      return Array.isArray(expected)
        ? expected.map((v) => String(v).toLowerCase()).includes(strA)
        : strB.split(',').map((v) => v.trim()).includes(strA);
    case 'exists':
      return strA !== '';
    case 'eq':
    default:
      return strA === strB;
  }
}

/**
 * Does this entity satisfy the rule's `conditions_json`?
 *
 * An empty / malformed condition object means "always" — a company that never
 * touched the advanced fields must not silently stop receiving automations.
 */
export function evaluateConditions(conditions: unknown, entity: AutomationEntity): boolean {
  if (conditions == null || typeof conditions !== 'object' || Array.isArray(conditions)) return true;
  const c = conditions as AutomationConditions;

  if (c.minTotal != null && !(Number(entity.total ?? 0) >= Number(c.minTotal))) return false;
  if (c.maxTotal != null && !(Number(entity.total ?? 0) <= Number(c.maxTotal))) return false;

  const currencies = asArray(c.currency);
  if (currencies.length && !currencies.includes(String(entity.currency ?? '').toLowerCase())) return false;

  const statuses = asArray(c.status);
  if (statuses.length && !statuses.includes(String(entity.status ?? '').toLowerCase())) return false;

  if (c.requireEmail && !(entity.customerEmail ?? '').trim()) return false;
  if (c.requirePhone && !(entity.customerPhone ?? '').trim()) return false;

  for (const clause of c.all ?? []) {
    if (!clause || typeof clause !== 'object' || !clause.field) continue;
    if (!compare(fieldValue(entity, clause.field), String(clause.op ?? 'eq'), clause.value)) return false;
  }
  return true;
}

// --- Topic → event mapping --------------------------------------------------

export type StoreProvider = 'shopify' | 'woocommerce';

const SHOPIFY_TOPICS: Record<string, AutomationEvent | null> = {
  'orders/create': 'order_created',
  'orders/paid': 'order_paid',
  // "updated" is not an event on its own — the payload's status decides.
  'orders/updated': null,
  'orders/cancelled': 'order_cancelled',
  'orders/fulfilled': 'order_shipped',
  'orders/partially_fulfilled': 'order_shipped',
  'refunds/create': 'order_refunded',
  // A Shopify checkout is a cart, not yet an abandonment: the route stores it
  // and the detector queues the message once it has been quiet long enough.
  'checkouts/create': 'cart_abandoned',
  'checkouts/update': 'cart_abandoned',
  'customers/create': 'customer_created',
};

const WOO_TOPICS: Record<string, AutomationEvent | null> = {
  'order/created': 'order_created',
  'order/updated': null,
  'order/deleted': 'order_cancelled',
  'customer/created': 'customer_created',
};

/** Normalise `orders.create`, `Orders/Create`, `order.updated` to one shape. */
function normaliseTopic(topic: string): string {
  return topic.trim().toLowerCase().replace(/\./g, '/');
}

/**
 * Map a provider webhook topic to an automation event.
 * `null` means "no fixed event" — derive it from the payload status instead.
 */
export function mapStoreTopic(provider: StoreProvider, topic: string): AutomationEvent | null {
  const key = normaliseTopic(topic);
  const table = provider === 'shopify' ? SHOPIFY_TOPICS : WOO_TOPICS;
  if (key in table) return table[key] ?? null;
  // Woo sends singular topics, Shopify plural; accept either from either.
  const alt = key.startsWith('order/') ? key.replace('order/', 'orders/') : key.replace('orders/', 'order/');
  return alt in table ? (table[alt] ?? null) : null;
}

export function isCheckoutTopic(provider: StoreProvider, topic: string): boolean {
  return provider === 'shopify' && normaliseTopic(topic).startsWith('checkouts/');
}

/**
 * Work out which lifecycle event a status change represents. Used for the
 * "updated" topics, where the topic itself says nothing.
 */
export function deriveOrderEvent(status: string | null, fulfillment: string | null): AutomationEvent | null {
  const s = (status ?? '').toLowerCase();
  const f = (fulfillment ?? '').toLowerCase();
  if (s === 'cancelled' || s === 'canceled' || s === 'voided') return 'order_cancelled';
  if (s === 'refunded' || s === 'partially_refunded') return 'order_refunded';
  if (f === 'delivered') return 'order_delivered';
  if (f === 'fulfilled' || f === 'shipped' || f === 'partial' || f === 'completed') return 'order_shipped';
  if (s === 'paid' || s === 'completed' || s === 'processing') return 'order_paid';
  return null;
}

// --- Abandoned carts --------------------------------------------------------

export const DEFAULT_ABANDON_MINUTES = 60;

/** How quiet a cart must be for a given rule. Falsy / invalid → the default. */
export function abandonThresholdMinutes(conditions: unknown, fallback = DEFAULT_ABANDON_MINUTES): number {
  const raw = (conditions as AutomationConditions | null)?.abandonAfterMinutes;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

/** Has this cart been untouched for at least `thresholdMinutes`? */
export function isCartAbandoned(
  updatedAt: string | Date | null | undefined,
  now: Date | number,
  thresholdMinutes = DEFAULT_ABANDON_MINUTES,
): boolean {
  if (!updatedAt) return false;
  const touched = typeof updatedAt === 'string' ? new Date(updatedAt) : updatedAt;
  const touchedMs = touched.getTime();
  if (!Number.isFinite(touchedMs)) return false;
  const nowMs = typeof now === 'number' ? now : now.getTime();
  return nowMs - touchedMs >= thresholdMinutes * 60_000;
}

/**
 * Where to send a customer to finish checking out. The provider's own recovery
 * URL is always better than ours (it restores their real basket), so it wins;
 * otherwise the site gets a marker the widget can read to rebuild the cart.
 */
export function buildRecoveryLink(params: {
  appUrl: string;
  cartId: string;
  checkoutUrl?: string | null;
}): string {
  const external = (params.checkoutUrl ?? '').trim();
  if (/^https?:\/\//i.test(external)) return external;
  const base = (params.appUrl || '').replace(/\/+$/, '');
  return `${base}/?recover_cart=${encodeURIComponent(params.cartId)}`;
}

/** The channel field a rule needs to reach the customer. */
export function contactForChannel(channel: string, entity: AutomationEntity): string | null {
  const value = channel === 'email' ? entity.customerEmail : entity.customerPhone;
  const trimmed = (value ?? '').trim();
  return trimmed || null;
}
