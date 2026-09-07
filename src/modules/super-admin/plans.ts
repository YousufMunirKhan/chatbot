/**
 * Plan catalogue (Module 4 onboarding / Module 19 billing).
 * Prices are placeholders until Stripe products are wired in Module 19.
 * `null` limit = unlimited.
 */

/**
 * The named product areas a plan can withhold (migration 0065).
 *
 * These live beside the numeric limits rather than in a system of their own
 * because they answer the same question — what does this company get for what
 * it pays — and every screen that shows one wants the other in the same breath.
 * A limit says how much of something; a flag says whether at all.
 *
 * Each name is a whole feature the owner can recognise from their own sidebar,
 * and each one is real: WhatsApp is migration 0054, guided chats are 0053, bulk
 * messages are 0046, chat invites are 0043, the public API is 0056, and agency
 * sub-accounts and white-label branding are 0057. Nothing joins this list
 * unless withholding it is a deliberate pricing decision — gating something
 * nobody would pay extra for buys support tickets and no revenue.
 */
export const PLAN_FEATURES = [
  'whatsapp',
  'flows',
  'broadcasts',
  'campaigns',
  'api_access',
  'agency',
  'custom_branding',
] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];

/**
 * A plan's answer for each feature. Deliberately partial: a feature the map
 * does not mention is granted, which is what `planFeatureEnabled` relies on.
 */
export type PlanFeatureSet = Partial<Record<PlanFeature, boolean>>;

/**
 * Owner-facing names, matching the sidebar word for word. Someone reading
 * "not included" next to "Bulk messages" has to be able to find the row it
 * refers to, so these are not allowed to drift from `dashboard-nav-items.ts`.
 */
export const PLAN_FEATURE_LABELS: Record<PlanFeature, string> = {
  whatsapp: 'WhatsApp',
  flows: 'Guided chats',
  broadcasts: 'Bulk messages',
  campaigns: 'Chat invites',
  api_access: 'API access',
  agency: 'Agency sub-accounts',
  custom_branding: 'Custom branding',
};

/** One plain sentence each, for the billing page's included/not-included list. */
export const PLAN_FEATURE_DESCRIPTIONS: Record<PlanFeature, string> = {
  whatsapp: 'Answer customers on WhatsApp with the same assistant.',
  flows: 'Conversations that run the same way every time, step by step.',
  broadcasts: 'Send one message to many customers at once.',
  campaigns: 'Invite visitors into a chat while they are on your site.',
  api_access: 'API keys, so your own systems can read and write your data.',
  agency: 'Run other businesses as sub-accounts under your own account.',
  custom_branding: 'Your logo and colours on the chat, and no "Powered by" line.',
};

export interface PlanDef {
  label: string;
  priceMonthly: number;
  messageLimit: number | null;
  botLimit: number | null;
  agentLimit: number | null;
  integrationLimit: number | null;
  includedCreditGbp: number;
  trialDays?: number;
  description: string;
  /**
   * What this plan does and does not include. Written out in full for every
   * package here so the pricing is readable in one place, but a missing entry
   * still means "granted" — see `planFeatureEnabled`.
   */
  features: PlanFeatureSet;
}

export const PLANS = {
  free_trial: {
    label: 'Free Trial',
    priceMonthly: 0,
    messageLimit: 100,
    botLimit: 1,
    agentLimit: 1,
    integrationLimit: 0,
    includedCreditGbp: 2,
    trialDays: 14,
    description: 'Proof period for one website assistant with a small AI credit cap.',
    // The trial proves the website assistant works. Everything a business would
    // renew for is deliberately behind the first paid tier.
    features: {
      whatsapp: false,
      flows: false,
      broadcasts: false,
      campaigns: false,
      api_access: false,
      agency: false,
      custom_branding: false,
    },
  },
  starter: {
    label: 'Starter',
    priceMonthly: 19,
    messageLimit: 500,
    botLimit: 1,
    agentLimit: 1,
    integrationLimit: 0,
    includedCreditGbp: 5,
    description: 'Small businesses that need website answers, lead capture, and bookings.',
    // Starter is the website package, and its own description says so: answers,
    // leads and bookings on one site. Outbound messaging and the other channels
    // are what Business is for.
    features: {
      whatsapp: false,
      flows: false,
      broadcasts: false,
      campaigns: false,
      api_access: false,
      agency: false,
      custom_branding: false,
    },
  },
  growth: {
    label: 'Business',
    priceMonthly: 49,
    messageLimit: 2000,
    botLimit: 2,
    agentLimit: 3,
    integrationLimit: 1,
    includedCreditGbp: 15,
    description: 'Higher chat volume, support workflows, and one connected business system.',
    // The step up is reach and repeatability: another channel to be found on,
    // scripted conversations, and the two ways of starting a chat first. What
    // stays back is what a developer or a reseller buys, not a shop owner.
    features: {
      whatsapp: true,
      flows: true,
      broadcasts: true,
      campaigns: true,
      api_access: false,
      agency: false,
      custom_branding: false,
    },
  },
  pro: {
    label: 'Pro',
    priceMonthly: 99,
    messageLimit: 5000,
    botLimit: 5,
    agentLimit: 10,
    integrationLimit: 3,
    includedCreditGbp: 35,
    description: 'Operational bots, help desk routing, and multiple integrations.',
    // Everything except reselling. Agency mode re-brands the whole product for
    // someone else's customers, which is a commercial arrangement rather than a
    // bigger version of this plan, so it is not something a card can buy.
    features: {
      whatsapp: true,
      flows: true,
      broadcasts: true,
      campaigns: true,
      api_access: true,
      agency: false,
      custom_branding: true,
    },
  },
  custom: {
    label: 'Custom',
    priceMonthly: 0,
    messageLimit: null,
    botLimit: null,
    agentLimit: null,
    integrationLimit: null,
    includedCreditGbp: 0,
    description: 'Quoted plan for high volume, dedicated integrations, or managed setup.',
    // Empty on purpose, which grants everything. A custom plan is negotiated
    // one company at a time, so what it includes is settled in the contract and
    // trimmed here per company with `feature_overrides` if it has to be.
    features: {},
  },
} satisfies Record<string, PlanDef>;

export type PlanKey = keyof typeof PLANS;
export const PLAN_KEYS = Object.keys(PLANS) as [PlanKey, ...PlanKey[]];

/**
 * Does this plan include this feature?
 *
 * Absence means yes, in both directions: a plan that says nothing about a
 * feature grants it, and a plan key this file has never heard of — every
 * package an operator creates in the billing catalogue is one — grants
 * everything. The alternative fails closed, and failing closed on a catalogue
 * that is edited inside the product would take features away from companies
 * already paying for them. That is a worse failure than the leak this layer
 * exists to plug, so the unknown case resolves to allow.
 */
export function planFeatureEnabled(
  plan: string | null | undefined,
  feature: PlanFeature,
): boolean {
  if (!plan || !(plan in PLANS)) return true;
  // Read through `PlanDef` rather than the literal type: `custom` declares an
  // empty map, so the inferred union has no key to index by feature name.
  const def: PlanDef = PLANS[plan as PlanKey];
  return def.features[feature] !== false;
}

export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'suspended',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export function planLabel(plan: string | null | undefined): string {
  return plan && plan in PLANS ? PLANS[plan as PlanKey].label : '—';
}
