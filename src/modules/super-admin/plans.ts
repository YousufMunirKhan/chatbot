/**
 * Plan catalogue (Module 4 onboarding / Module 19 billing).
 * Prices are placeholders until Stripe products are wired in Module 19.
 * `null` limit = unlimited.
 */
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
  },
} satisfies Record<string, PlanDef>;

export type PlanKey = keyof typeof PLANS;
export const PLAN_KEYS = Object.keys(PLANS) as [PlanKey, ...PlanKey[]];

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
