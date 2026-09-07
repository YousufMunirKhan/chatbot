import { cache } from 'react';
import { assertRole, getSessionUser } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { ForbiddenError, UnauthorizedError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import type { CompanyCard, CompanyInvoice } from './billing-format';
import {
  createStripeCustomer,
  getStripeKey,
  getStripeSubscription,
  listStripeCards,
  listStripeInvoices,
  type StripeSubscriptionState,
} from './billing-stripe';
import { getCompanyId } from './data';

/**
 * Everything the billing page needs from Stripe, and the one write that makes
 * the hosted flows possible: a Stripe customer for this company.
 *
 * TENANCY
 * -------
 * The service client bypasses row-level security, so the `company_id` filter on
 * every query below IS the boundary. The id always comes from `getCompanyId()`,
 * which reads the session — never a request body, never a query string. That is
 * also what stops a forged `session_id` on the card-setup return handler from
 * writing another tenant's payment method into this company's settings: the
 * customer on the Stripe session is compared against the customer stored on
 * THIS company's row before anything is saved.
 *
 * NOT GATED BY PLAN
 * -----------------
 * `src/lib/entitlements.ts` gates named product areas — WhatsApp, guided chats,
 * bulk messages, chat invites, API access, agency, custom branding. Billing is
 * not one of them and must not become one: locking a customer out of their own
 * invoices or the cancel button because of the plan they are on is the failure
 * mode regulators and chargebacks are made of. The gate here is the role — only
 * a company admin — and that is enforced in the routes as well as the page.
 */

/**
 * Company id for a billing route handler, or a thrown `AppError`.
 *
 * `requireRole()` cannot be used here: it answers a failure with `redirect()`,
 * which inside a route handler becomes a thrown NEXT_REDIRECT that
 * `handleApiError` reports as a 500. Route handlers need the throwing variant,
 * the same way `src/app/api/company/knowledge/status/route.ts` does it.
 */
export async function requireBillingAdminCompany(): Promise<string> {
  const user = await getSessionUser();
  if (!user) throw new UnauthorizedError();
  // Only an admin. An agent can read the inbox; nobody but the owner of the
  // account changes what it is billed.
  assertRole(user, [ROLES.COMPANY_ADMIN]);
  if (!user.companyId) throw new ForbiddenError('This account is not attached to a company.');
  return user.companyId;
}

/** The subscription row's Stripe identifiers. Either can be null. */
export interface StripeIdentifiers {
  customerId: string | null;
  subscriptionId: string | null;
  /** False when the company has no subscription row at all. */
  hasRow: boolean;
}

async function readStripeIdentifiers(companyId: string): Promise<StripeIdentifiers> {
  const { data, error } = await createSupabaseServiceClient()
    .from('subscriptions')
    .select('stripe_customer_id, stripe_subscription_id')
    .eq('company_id', companyId) // the isolation boundary — see the note above
    .maybeSingle();

  if (error) {
    logger.error('Could not read Stripe identifiers', {
      companyId,
      error: error.message,
      module: 'company/billing',
    });
    return { customerId: null, subscriptionId: null, hasRow: false };
  }
  const row = (data ?? null) as { stripe_customer_id?: string | null; stripe_subscription_id?: string | null } | null;
  return {
    customerId: row?.stripe_customer_id ?? null,
    subscriptionId: row?.stripe_subscription_id ?? null,
    hasRow: row !== null,
  };
}

/**
 * The company's Stripe customer id, creating one the first time it is needed.
 *
 * Deliberately NOT called while a page renders. A company that has never paid
 * for anything should not acquire a Stripe customer because somebody opened a
 * screen; the customer is created when an admin asks for something that
 * genuinely requires one — the portal, or saving a card. Checkout also creates
 * one via the webhook, and this reuses that id when it is already there.
 *
 * TWO ADMINS, ONE CUSTOMER. The create call carries a deterministic idempotency
 * key, so two clicks in the same moment resolve to the same Stripe customer
 * rather than two customers each holding half the history. The database write
 * is then conditional on the column still being null, and the loser of that
 * race re-reads and uses the stored value.
 */
export async function ensureStripeCustomer(params: {
  secretKey: string;
  companyId: string;
  companyName: string;
  email: string | null;
}): Promise<{ ok: true; customerId: string } | { ok: false; error: string }> {
  const sb = createSupabaseServiceClient();
  const existing = await readStripeIdentifiers(params.companyId);
  if (existing.customerId) return { ok: true, customerId: existing.customerId };

  const created = await createStripeCustomer({
    secretKey: params.secretKey,
    companyId: params.companyId,
    name: params.companyName,
    email: params.email,
  });
  if (!created.ok) return { ok: false, error: created.error };

  if (existing.hasRow) {
    const { data } = await sb
      .from('subscriptions')
      .update({ stripe_customer_id: created.data.id })
      .eq('company_id', params.companyId)
      .is('stripe_customer_id', null)
      .select('stripe_customer_id')
      .maybeSingle();

    if (!data) {
      // Somebody else got there first. Their id is the one already on the row
      // and the one Stripe's webhook will keep updating, so use it.
      const again = await readStripeIdentifiers(params.companyId);
      if (again.customerId) return { ok: true, customerId: again.customerId };
    }
  } else {
    // Every company-creation path in this repo inserts a subscriptions row, so
    // this is the "should not happen" branch — but losing a paid-for Stripe
    // customer because a row was missing is not an acceptable way to find out.
    const { error } = await sb
      .from('subscriptions')
      .upsert({ company_id: params.companyId, stripe_customer_id: created.data.id }, { onConflict: 'company_id' });
    if (error) {
      logger.error('Created a Stripe customer but could not store it', {
        companyId: params.companyId,
        customerId: created.data.id,
        error: error.message,
        module: 'company/billing',
      });
      return { ok: false, error: 'Your billing account was created but could not be saved. Try again.' };
    }
  }

  return { ok: true, customerId: created.data.id };
}

/**
 * Everything the billing page shows that lives on Stripe's side.
 *
 * `error` is a value rather than a throw on purpose: see the note at the top of
 * `billing-stripe.ts`. A page that cannot reach Stripe still renders the plan,
 * the allowance and the entitlements, with one line explaining what is missing.
 */
export interface BillingAccountView {
  /** False when no Stripe secret is configured for the platform at all. */
  stripeConfigured: boolean;
  customerId: string | null;
  subscriptionId: string | null;
  invoices: CompanyInvoice[];
  cards: CompanyCard[];
  subscription: StripeSubscriptionState | null;
  error: string | null;
}

const EMPTY: BillingAccountView = {
  stripeConfigured: false,
  customerId: null,
  subscriptionId: null,
  invoices: [],
  cards: [],
  subscription: null,
  error: null,
};

/**
 * `cache()`d because the page reads it from two places — the plan card wants
 * the renewal date, the invoice table and the top-up form want the rest — and
 * one render must not pay for the same three Stripe round trips twice.
 */
export const getBillingAccount = cache(async function getBillingAccount(): Promise<BillingAccountView> {
  const companyId = await getCompanyId();
  const key = await getStripeKey();
  if (!key.ok) return { ...EMPTY, error: key.error };

  const ids = await readStripeIdentifiers(companyId);
  if (!ids.customerId) {
    // Nothing to fetch yet, and nothing wrong: a company on a free trial that
    // has never paid has no Stripe customer until it asks for one.
    return { ...EMPTY, stripeConfigured: true, subscriptionId: ids.subscriptionId };
  }

  const [invoices, cards, subscription] = await Promise.all([
    listStripeInvoices(key.data.secretKey, ids.customerId),
    listStripeCards(key.data.secretKey, ids.customerId),
    ids.subscriptionId
      ? getStripeSubscription(key.data.secretKey, ids.subscriptionId)
      : Promise.resolve(null),
  ]);

  // One failure is reported; the parts that succeeded are still shown. Losing
  // the card list is not a reason to hide six months of invoices.
  const failure =
    (!invoices.ok && invoices.error) ||
    (!cards.ok && cards.error) ||
    (subscription && !subscription.ok && subscription.error) ||
    null;

  return {
    stripeConfigured: true,
    customerId: ids.customerId,
    subscriptionId: ids.subscriptionId,
    invoices: invoices.ok ? invoices.data : [],
    cards: cards.ok ? cards.data : [],
    subscription: subscription?.ok ? subscription.data : null,
    error: failure || null,
  };
});

/** Name and admin email for the Stripe customer record. */
export async function getStripeCustomerIdentity(
  companyId: string,
): Promise<{ name: string; email: string | null }> {
  const [{ data }, user] = await Promise.all([
    createSupabaseServiceClient().from('companies').select('name').eq('id', companyId).maybeSingle(),
    getSessionUser(),
  ]);
  const name = ((data as { name?: string } | null)?.name ?? '').trim();
  return {
    // Stripe shows this name on the invoice and in the portal header, so an
    // empty company name would leave the customer looking at a blank account.
    name: name || `Company ${companyId.slice(0, 8)}`,
    email: user?.email ?? null,
  };
}
