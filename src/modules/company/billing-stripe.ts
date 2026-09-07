import { getPlatformStripeSettings } from '@/lib/platform-settings';
import { logger } from '@/lib/logger';
import type { CompanyCard, CompanyInvoice } from './billing-format';

/**
 * The small slice of the Stripe REST API the company billing screen needs.
 *
 * WHY REST AND NOT THE SDK
 * ------------------------
 * `stripe` is a dependency of this repo, but only the webhook uses it, and only
 * for `constructEvent` — signature verification is the one thing worth pulling a
 * library in for. Everything else that talks to Stripe here (checkout sessions
 * in `src/app/api/billing/checkout/route.ts`, off-session charges in
 * `src/lib/billing/auto-topup.ts`) posts form-encoded bodies with `fetch`, and
 * this file follows them so there is one calling convention to learn rather than
 * two, and so a pinned SDK version can never disagree with the API version the
 * rest of the billing code is written against.
 *
 * WHY EVERY CALL RETURNS A RESULT INSTEAD OF THROWING
 * ---------------------------------------------------
 * Half these calls happen while a page is rendering. Stripe being slow, down, or
 * missing a portal configuration must not turn "Billing" into an error boundary
 * — an admin whose card just failed is exactly the person who cannot be shown a
 * blank screen. So the failure is a value, the page prints it, and the parts
 * that do not depend on Stripe (plan, allowance, entitlements) still render.
 */

const STRIPE_API = 'https://api.stripe.com/v1';

/** Stripe stops responding long before this; the timeout is for a hung socket. */
const STRIPE_TIMEOUT_MS = 12_000;

export type StripeResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface StripeCall {
  secretKey: string;
  /** Path under /v1, e.g. `billing_portal/sessions`. */
  path: string;
  method?: 'GET' | 'POST';
  /** Form fields for POST, or query parameters for GET. */
  params?: Record<string, string>;
  /**
   * Makes a retried POST reuse the first result instead of creating a second
   * object. Only meaningful on POST — Stripe ignores it elsewhere.
   */
  idempotencyKey?: string;
}

/**
 * One Stripe call. Errors come back as the message Stripe wrote, because the
 * people who read them here are a company admin and whoever they forward it to,
 * and "Stripe error" has never once told either of them what to do next.
 */
export async function stripeCall<T>({
  secretKey,
  path,
  method = 'POST',
  params,
  idempotencyKey,
}: StripeCall): Promise<StripeResult<T>> {
  const body = new URLSearchParams(params ?? {});
  const url = method === 'GET' && params ? `${STRIPE_API}/${path}?${body.toString()}` : `${STRIPE_API}/${path}`;

  const headers: Record<string, string> = { Authorization: `Bearer ${secretKey}` };
  if (method === 'POST') headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: method === 'POST' ? body.toString() : undefined,
      signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('Stripe request failed before a response', { path, error: message, module: 'company/billing' });
    return { ok: false, error: 'Could not reach Stripe. Try again in a moment.' };
  }

  const payload = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) {
    const error = payload.error?.message ?? `Stripe returned ${res.status}.`;
    logger.warn('Stripe request rejected', { path, status: res.status, error, module: 'company/billing' });
    return { ok: false, error };
  }
  return { ok: true, data: payload as T };
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

interface RawInvoice {
  id?: string;
  number?: string | null;
  created?: number;
  status?: string | null;
  total?: number;
  currency?: string;
  hosted_invoice_url?: string | null;
  invoice_pdf?: string | null;
}

function mapInvoice(raw: RawInvoice): CompanyInvoice {
  return {
    id: raw.id ?? '',
    number: raw.number ?? null,
    // Stripe timestamps are seconds; `new Date(seconds)` is 1970 and nobody
    // notices until a customer asks why every invoice is dated January.
    createdIso: new Date((raw.created ?? 0) * 1000).toISOString(),
    status: raw.status ?? 'unknown',
    total: Number(raw.total ?? 0),
    currency: raw.currency ?? 'gbp',
    hostedInvoiceUrl: raw.hosted_invoice_url ?? null,
    invoicePdfUrl: raw.invoice_pdf ?? null,
  };
}

/** The customer's most recent invoices, newest first (Stripe's own order). */
export async function listStripeInvoices(
  secretKey: string,
  customerId: string,
  limit = 12,
): Promise<StripeResult<CompanyInvoice[]>> {
  const res = await stripeCall<{ data?: RawInvoice[] }>({
    secretKey,
    path: 'invoices',
    method: 'GET',
    params: { customer: customerId, limit: String(limit) },
  });
  if (!res.ok) return res;
  return { ok: true, data: (res.data.data ?? []).map(mapInvoice) };
}

// ---------------------------------------------------------------------------
// Saved cards
// ---------------------------------------------------------------------------

interface RawPaymentMethod {
  id?: string;
  card?: { brand?: string; last4?: string; exp_month?: number; exp_year?: number };
}

/**
 * Cards attached to the customer, with the subscription's default marked.
 *
 * Two calls, because Stripe keeps the default on the customer rather than on
 * the payment method. They run together — the list is useless without knowing
 * which one is already in use, and asking in sequence doubles the page's wait.
 */
export async function listStripeCards(
  secretKey: string,
  customerId: string,
): Promise<StripeResult<CompanyCard[]>> {
  const [methods, customer] = await Promise.all([
    stripeCall<{ data?: RawPaymentMethod[] }>({
      secretKey,
      path: 'payment_methods',
      method: 'GET',
      params: { customer: customerId, type: 'card', limit: '20' },
    }),
    stripeCall<{ invoice_settings?: { default_payment_method?: string | null } }>({
      secretKey,
      path: `customers/${encodeURIComponent(customerId)}`,
      method: 'GET',
    }),
  ]);
  if (!methods.ok) return methods;

  // A missing customer read is not worth failing the list over: the worst that
  // happens is no card shows the "Default" tag.
  const defaultId = customer.ok ? (customer.data.invoice_settings?.default_payment_method ?? null) : null;

  return {
    ok: true,
    data: (methods.data.data ?? []).map((raw) => ({
      id: raw.id ?? '',
      brand: raw.card?.brand ?? 'card',
      last4: raw.card?.last4 ?? '••••',
      expMonth: Number(raw.card?.exp_month ?? 0),
      expYear: Number(raw.card?.exp_year ?? 0),
      isDefault: Boolean(raw.id && defaultId && raw.id === defaultId),
    })),
  };
}

// ---------------------------------------------------------------------------
// Subscription
// ---------------------------------------------------------------------------

export interface StripeSubscriptionState {
  id: string;
  status: string;
  currentPeriodEndIso: string | null;
  /** Already cancelled, still paid up until the period end. */
  cancelAtPeriodEnd: boolean;
}

/**
 * The renewal facts Stripe owns and this database does not: nothing in the
 * webhook writes `current_period_end`, and "cancels on the 5th" is not stored
 * here at all, so both are read live or not shown.
 */
export async function getStripeSubscription(
  secretKey: string,
  subscriptionId: string,
): Promise<StripeResult<StripeSubscriptionState>> {
  const res = await stripeCall<{
    id?: string;
    status?: string;
    current_period_end?: number;
    cancel_at_period_end?: boolean;
  }>({
    secretKey,
    path: `subscriptions/${encodeURIComponent(subscriptionId)}`,
    method: 'GET',
  });
  if (!res.ok) return res;
  return {
    ok: true,
    data: {
      id: res.data.id ?? subscriptionId,
      status: res.data.status ?? 'unknown',
      currentPeriodEndIso: res.data.current_period_end
        ? new Date(res.data.current_period_end * 1000).toISOString()
        : null,
      cancelAtPeriodEnd: res.data.cancel_at_period_end === true,
    },
  };
}

// ---------------------------------------------------------------------------
// Hosted flows
// ---------------------------------------------------------------------------

/**
 * The portal flows this app links to. Stripe's hosted portal is the whole
 * answer to invoices, cards, plan changes and cancellation — none of that is
 * rebuilt here, because rebuilding it means holding card data, handling SCA,
 * and getting dunning right, and Stripe already did.
 */
export type PortalFlow = 'payment_method_update' | 'subscription_update' | 'subscription_cancel';

export async function createPortalSession(params: {
  secretKey: string;
  customerId: string;
  returnUrl: string;
  flow?: PortalFlow;
  /** Required by Stripe for the two subscription flows. */
  subscriptionId?: string | null;
}): Promise<StripeResult<{ url: string }>> {
  const form: Record<string, string> = {
    customer: params.customerId,
    return_url: params.returnUrl,
  };

  // The subscription flows are only offered when we know which subscription
  // they act on; asking Stripe for them without one is a guaranteed 400.
  if (params.flow === 'payment_method_update') {
    form['flow_data[type]'] = 'payment_method_update';
  } else if (params.flow && params.subscriptionId) {
    form['flow_data[type]'] = params.flow;
    form[`flow_data[${params.flow}][subscription]`] = params.subscriptionId;
  }

  const res = await stripeCall<{ url?: string }>({
    secretKey: params.secretKey,
    path: 'billing_portal/sessions',
    params: form,
  });
  if (!res.ok) return res;
  if (!res.data.url) return { ok: false, error: 'Stripe did not return a portal link.' };
  return { ok: true, data: { url: res.data.url } };
}

/**
 * A Stripe-hosted page that saves a card and nothing else.
 *
 * `mode=setup` is the replacement for the field that used to ask a customer to
 * paste a `pm_…` id. Stripe collects the card on its own domain, attaches it to
 * the customer, and hands back a SetupIntent whose payment method this app can
 * then charge off-session — which is what auto top-up needs and what a customer
 * could never have produced by hand. No card detail passes through this server.
 */
export async function createCardSetupSession(params: {
  secretKey: string;
  customerId: string;
  companyId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<StripeResult<{ url: string }>> {
  const res = await stripeCall<{ url?: string }>({
    secretKey: params.secretKey,
    path: 'checkout/sessions',
    params: {
      mode: 'setup',
      customer: params.customerId,
      currency: 'gbp',
      'payment_method_types[0]': 'card',
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      // Checkout's setup mode already sets usage=off_session; the metadata is
      // what lets the return handler prove the session belongs to this company.
      'setup_intent_data[metadata][company_id]': params.companyId,
      'metadata[company_id]': params.companyId,
      'metadata[purpose]': 'auto_topup_card',
    },
  });
  if (!res.ok) return res;
  if (!res.data.url) return { ok: false, error: 'Stripe did not return a setup link.' };
  return { ok: true, data: { url: res.data.url } };
}

export interface CardSetupOutcome {
  /** The customer the session was created for — checked against ours. */
  customerId: string | null;
  companyId: string | null;
  paymentMethodId: string | null;
  status: string | null;
}

/** Read back a finished setup session so the saved card can be selected for the customer. */
export async function getCardSetupSession(
  secretKey: string,
  sessionId: string,
): Promise<StripeResult<CardSetupOutcome>> {
  const res = await stripeCall<{
    customer?: string | null;
    status?: string | null;
    metadata?: { company_id?: string };
    setup_intent?: { payment_method?: string | null; status?: string | null } | string | null;
  }>({
    secretKey,
    path: `checkout/sessions/${encodeURIComponent(sessionId)}`,
    method: 'GET',
    params: { 'expand[0]': 'setup_intent' },
  });
  if (!res.ok) return res;

  const intent = res.data.setup_intent;
  const paymentMethodId =
    intent && typeof intent === 'object' ? (intent.payment_method ?? null) : null;

  return {
    ok: true,
    data: {
      customerId: typeof res.data.customer === 'string' ? res.data.customer : null,
      companyId: res.data.metadata?.company_id ?? null,
      paymentMethodId,
      status: res.data.status ?? null,
    },
  };
}

/** Create a Stripe customer for a company. See `ensureStripeCustomer`. */
export async function createStripeCustomer(params: {
  secretKey: string;
  companyId: string;
  name: string;
  email: string | null;
}): Promise<StripeResult<{ id: string }>> {
  const form: Record<string, string> = {
    name: params.name,
    'metadata[company_id]': params.companyId,
  };
  if (params.email) form.email = params.email;

  const res = await stripeCall<{ id?: string }>({
    secretKey: params.secretKey,
    path: 'customers',
    params: form,
    // Deterministic on purpose: two admins clicking "Manage billing" at the
    // same second must not end up with two Stripe customers for one company,
    // each holding half the cards and half the invoices.
    idempotencyKey: `company-customer-${params.companyId}`,
  });
  if (!res.ok) return res;
  if (!res.data.id) return { ok: false, error: 'Stripe did not return a customer id.' };
  return { ok: true, data: { id: res.data.id } };
}

/** Stripe settings, or the reason billing cannot run. */
export async function getStripeKey(): Promise<StripeResult<{ secretKey: string }>> {
  const settings = await getPlatformStripeSettings();
  if (!settings.enabled || !settings.secretKey) {
    return { ok: false, error: 'Card payments are not switched on for this platform yet.' };
  }
  return { ok: true, data: { secretKey: settings.secretKey } };
}
