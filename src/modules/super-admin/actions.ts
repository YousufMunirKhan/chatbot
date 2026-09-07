'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { logger } from '@/lib/logger';
import { runEval } from '@/lib/ai/eval';
import { currentMonthEndIso } from '@/lib/billing';
import {
  classifyMembers,
  getCompanyDeletionPreview,
  type CompanyDeletionPreview,
} from './deletion-data';
import { sendImprovementEmail } from './improvements-data';
import {
  PLANS,
  PLAN_FEATURES,
  PLAN_KEYS,
  SUBSCRIPTION_STATUSES,
  type PlanFeature,
  type PlanFeatureSet,
} from './plans';

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

async function writeAudit(
  sb: ServiceClient,
  entry: {
    companyId?: string | null;
    actorId?: string | null;
    action: string;
    targetType?: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
  },
) {
  await sb.from('audit_logs').insert({
    company_id: entry.companyId ?? null,
    actor_user_id: entry.actorId ?? null,
    action: entry.action,
    target_type: entry.targetType ?? null,
    target_id: entry.targetId ?? null,
    metadata_json: entry.metadata ?? {},
  });
}

/**
 * A plan limit. `nonnegative`, NOT `positive`: `0` is a real, shipped value —
 * Free Trial and Starter both carry `integrationLimit: 0` — and rejecting it
 * meant opening the plan form on those companies and pressing save threw.
 */
const optNum = z.preprocess(
  (x) => (x === '' || x == null ? undefined : x),
  z.coerce.number().int().nonnegative('Limits cannot be negative').optional(),
);
/** `on` from a checkbox, for limits an operator wants explicitly uncapped. */
const optFlag = z.preprocess((x) => x === 'on', z.boolean());
const optMoney = z.preprocess(
  (x) => (x === '' || x == null ? undefined : x),
  z.coerce.number().nonnegative().optional(),
);
const optDate = z.preprocess((x) => (x === '' || x == null ? undefined : x), z.string().optional());
const optText = z.preprocess((x) => (x === '' || x == null ? undefined : x), z.string().optional());

export type ActionState = { error?: string };

function slugify(value: string): string {
  const base = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${base || 'company'}-${Math.random().toString(36).slice(2, 7)}`;
}

// ---------------------------------------------------------------------------
// Onboard a company + its first company admin (Module 4 core flow).
// ---------------------------------------------------------------------------
const onboardSchema = z.object({
  name: z.string().min(2, 'Company name is required'),
  website: z.preprocess((x) => (x === '' ? undefined : x), z.string().url().optional()),
  country: optText,
  defaultLanguage: z.enum(['en', 'ar', 'auto']).default('auto'),
  adminName: optText,
  adminEmail: z.string().email('Valid admin email required'),
  adminPassword: z.string().min(8, 'Password must be at least 8 characters'),
  plan: z.enum(PLAN_KEYS),
  freeUntil: optDate,
  messageLimit: optNum,
  agentLimit: optNum,
  botLimit: optNum,
  integrationLimit: optNum,
  monthlyAiBudgetUsd: optMoney,
  hardStopEnabled: z.preprocess((x) => x === 'on', z.boolean()).default(false),
  cacheEnabled: z.preprocess((x) => x !== 'off', z.boolean()).default(true),
  initialCreditAmount: optMoney,
  setupFeeAmount: optMoney,
  apiWebhookAddon: z.preprocess((x) => x === 'on', z.boolean()).default(false),
  privacyAcknowledged: z.preprocess((x) => x === 'on', z.boolean()).default(false),
});

export async function createCompanyAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireRole([ROLES.SUPER_ADMIN]);
  const parsed = onboardSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const v = parsed.data;
  if (!v.privacyAcknowledged) {
    return {
      error: 'Confirm the privacy and data processing notice before onboarding this company.',
    };
  }
  const sb = createSupabaseServiceClient();

  // 1. Company
  const { data: company, error: cErr } = await sb
    .from('companies')
    .insert({
      name: v.name,
      slug: slugify(v.name),
      website: v.website ?? null,
      country: v.country ?? null,
      default_language: v.defaultLanguage,
    })
    .select('id')
    .single();
  if (cErr || !company) return { error: 'Could not create company: ' + (cErr?.message ?? '') };

  // 2. Subscription (plan defaults + overrides)
  const plan = PLANS[v.plan];
  const { error: sErr } = await sb.from('subscriptions').insert({
    company_id: company.id,
    plan: v.plan,
    status: v.plan === 'free_trial' ? 'trialing' : 'active',
    free_until: v.freeUntil ?? null,
    message_limit: v.messageLimit ?? plan.messageLimit,
    bot_limit: v.botLimit ?? plan.botLimit,
    agent_limit: v.agentLimit ?? plan.agentLimit,
    integration_limit: v.integrationLimit ?? plan.integrationLimit,
    // `overage_enabled` / `overage_unit_price` are deliberately NOT written.
    // The columns exist (migration 0018) but nothing in the billing enforcement
    // path (`src/lib/billing`) reads them, so the onboarding controls promised a
    // paid-overage policy that could never take effect. The inputs have been
    // removed rather than left as decoration; restore them together with real
    // enforcement.
  });
  if (sErr) {
    await sb.from('companies').delete().eq('id', company.id);
    return { error: 'Could not create subscription: ' + sErr.message };
  }

  const { error: budgetErr } = await sb.from('company_ai_budgets').upsert({
    company_id: company.id,
    monthly_budget_usd: v.monthlyAiBudgetUsd ?? null,
    hard_stop_enabled: v.hardStopEnabled,
    cache_enabled: v.cacheEnabled,
    updated_by: admin.userId,
  });
  if (budgetErr) {
    await sb.from('companies').delete().eq('id', company.id);
    return { error: 'Could not create AI budget controls: ' + budgetErr.message };
  }

  const startingCredit = v.initialCreditAmount ?? plan.includedCreditGbp;
  const { error: creditErr } = await sb.from('company_credit_accounts').upsert({
    company_id: company.id,
    currency: 'GBP',
    balance_amount: startingCredit,
    lifetime_credit_added: startingCredit,
    low_balance_threshold: 2,
  });
  if (creditErr) {
    await sb.from('companies').delete().eq('id', company.id);
    return { error: 'Could not create customer AI credit wallet: ' + creditErr.message };
  }
  if (startingCredit > 0) {
    const { error: txErr } = await sb.from('company_credit_transactions').insert({
      company_id: company.id,
      type: v.initialCreditAmount == null ? 'included_credit' : 'top_up',
      amount: startingCredit,
      currency: 'GBP',
      description:
        v.initialCreditAmount == null ? `${plan.label} included AI credit` : 'Initial AI credit',
      created_by: admin.userId,
      metadata_json: { plan: v.plan },
    });
    if (txErr) {
      await sb.from('companies').delete().eq('id', company.id);
      return { error: 'Could not record starting AI credit: ' + txErr.message };
    }
  }

  if ((v.setupFeeAmount ?? 0) > 0) {
    const { error: setupFeeErr } = await sb.from('company_commercial_charges').insert({
      company_id: company.id,
      charge_type: 'setup_fee',
      amount: v.setupFeeAmount,
      currency: 'GBP',
      status: 'quoted',
      description: 'Onboarding and setup fee',
      created_by: admin.userId,
      metadata_json: { plan: v.plan },
    });
    if (setupFeeErr) {
      await sb.from('companies').delete().eq('id', company.id);
      return { error: 'Could not record setup fee: ' + setupFeeErr.message };
    }
  }

  if (v.apiWebhookAddon) {
    const { error: addonErr } = await sb.from('company_addons').upsert({
      company_id: company.id,
      key: 'api_webhooks',
      label: 'API and webhooks access',
      price_monthly: 10,
      currency: 'GBP',
      status: 'active',
      metadata_json: { enabledFromOnboarding: true },
    });
    if (addonErr) {
      await sb.from('companies').delete().eq('id', company.id);
      return { error: 'Could not enable API/webhooks add-on: ' + addonErr.message };
    }
    await sb.from('company_commercial_charges').insert({
      company_id: company.id,
      charge_type: 'api_webhooks_addon',
      amount: 10,
      currency: 'GBP',
      status: 'quoted',
      description: 'API and webhooks add-on, monthly',
      created_by: admin.userId,
      metadata_json: { recurring: 'monthly' },
    });
  }

  // 3. Company-admin auth user (the trigger creates the public.users profile)
  const { data: created, error: uErr } = await sb.auth.admin.createUser({
    email: v.adminEmail,
    password: v.adminPassword,
    email_confirm: true,
    user_metadata: { full_name: v.adminName ?? null },
  });
  if (uErr || !created?.user) {
    await sb.from('companies').delete().eq('id', company.id); // cascades subscription
    return { error: 'Could not create admin user: ' + (uErr?.message ?? 'unknown error') };
  }

  // 4. Membership
  const { error: mErr } = await sb
    .from('company_users')
    .insert({ company_id: company.id, user_id: created.user.id, role: ROLES.COMPANY_ADMIN });
  if (mErr) {
    // The company, subscription, budgets, credit wallet and auth user are all
    // persisted by now — without this the orphaned company stays invisible on
    // the list page until an unrelated write revalidates it.
    revalidatePath('/super-admin/companies');
    return { error: 'Company created but linking admin failed: ' + mErr.message };
  }

  // 5. Audit
  await writeAudit(sb, {
    companyId: company.id,
    actorId: admin.userId,
    action: 'company.onboarded',
    targetType: 'company',
    targetId: company.id,
    metadata: {
      plan: v.plan,
      adminEmail: v.adminEmail,
      messageLimit: v.messageLimit ?? plan.messageLimit,
      agentLimit: v.agentLimit ?? plan.agentLimit,
      botLimit: v.botLimit ?? plan.botLimit,
      integrationLimit: v.integrationLimit ?? plan.integrationLimit,
      monthlyAiBudgetUsd: v.monthlyAiBudgetUsd ?? null,
      hardStopEnabled: v.hardStopEnabled,
      cacheEnabled: v.cacheEnabled,
      startingCreditGbp: startingCredit,
      setupFeeGbp: v.setupFeeAmount ?? 0,
      apiWebhookAddon: v.apiWebhookAddon,
      privacyAcknowledged: v.privacyAcknowledged,
    },
  });

  logger.info('Company onboarded', { companyId: company.id, module: 'super-admin' });
  revalidatePath('/super-admin/companies');
  redirect(`/super-admin/companies/${company.id}`);
}

// ---------------------------------------------------------------------------
// Activate / suspend a company.
// ---------------------------------------------------------------------------
const statusSchema = z.object({
  companyId: z.string().uuid(),
  status: z.enum(['active', 'suspended']),
});

export async function setCompanyStatusAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireRole([ROLES.SUPER_ADMIN]);
  const parsed = statusSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const v = parsed.data;
  const sb = createSupabaseServiceClient();

  const { error: companyErr } = await sb
    .from('companies')
    .update({ status: v.status })
    .eq('id', v.companyId);
  if (companyErr) return { error: `Could not update the company: ${companyErr.message}` };

  // Suspending mirrors onto the subscription so the AI stops; activating has to
  // mirror back, or the company goes "active" while `withinMessageQuota()` keeps
  // returning false off the still-suspended subscription and the assistant stays
  // dead with nothing on screen to explain it.
  const { data: sub, error: subReadErr } = await sb
    .from('subscriptions')
    .select('plan,status')
    .eq('company_id', v.companyId)
    .maybeSingle();
  if (subReadErr) return { error: `Could not read the subscription: ${subReadErr.message}` };

  let subscriptionStatus: string | null = null;
  if (v.status === 'suspended') {
    if (sub && sub.status !== 'suspended') subscriptionStatus = 'suspended';
  } else if (sub?.status === 'suspended') {
    // Only un-suspend. A `past_due` or `canceled` subscription is a separate
    // billing fact and must not be silently overwritten by a status toggle.
    subscriptionStatus = sub.plan === 'free_trial' ? 'trialing' : 'active';
  }
  if (subscriptionStatus) {
    const { error: subErr } = await sb
      .from('subscriptions')
      .update({ status: subscriptionStatus })
      .eq('company_id', v.companyId);
    if (subErr) {
      return {
        error: `Company set to ${v.status}, but its subscription could not be updated: ${subErr.message}`,
      };
    }
  }

  await writeAudit(sb, {
    companyId: v.companyId,
    actorId: admin.userId,
    action: v.status === 'suspended' ? 'company.suspended' : 'company.activated',
    targetType: 'company',
    targetId: v.companyId,
    metadata: { companyStatus: v.status, subscriptionStatus },
  });
  revalidatePath(`/super-admin/companies/${v.companyId}`);
  revalidatePath(`/super-admin/companies/${v.companyId}/manage`);
  revalidatePath('/super-admin/companies');
  revalidatePath('/super-admin/subscriptions');
  return {};
}

// ---------------------------------------------------------------------------
// Update a company's subscription (plan, status, free-until, message limit).
// ---------------------------------------------------------------------------
const subSchema = z.object({
  companyId: z.string().uuid(),
  plan: z.string().min(2),
  status: z.enum(SUBSCRIPTION_STATUSES),
  freeUntil: optDate,
  messageLimit: optNum,
  messageLimitUnlimited: optFlag,
  agentLimit: optNum,
  agentLimitUnlimited: optFlag,
  botLimit: optNum,
  botLimitUnlimited: optFlag,
  integrationLimit: optNum,
  integrationLimitUnlimited: optFlag,
});

/**
 * Resolve one limit field to the value that goes in the column.
 *
 * A blank input used to mean opposite things in the two forms: onboarding fell
 * back to the plan default, editing wrote `null` (= unlimited). Because `0` was
 * rejected by the old schema, clearing the field was the only way to get past
 * the crash — so the workaround for a validation bug silently handed the company
 * unlimited integrations.
 *
 * Both forms now agree: **blank = inherit the plan default**. Unlimited is a
 * separate, explicit checkbox, and the form says so next to the fields.
 */
function resolveLimit(
  entered: number | undefined,
  unlimited: boolean,
  planDefault: number | null | undefined,
): number | null {
  if (unlimited) return null;
  if (entered != null) return entered;
  return planDefault ?? null;
}

/** `null` clears the exception and puts the feature back on the package's answer. */
interface FeatureChange {
  feature: PlanFeature;
  value: boolean | null;
}

/**
 * The feature exceptions the operator actually changed on this submit.
 *
 * Each control posts its current choice AND, in a companion `_was` field, the
 * choice it was drawn with. Only a difference between the two counts as a
 * decision. That distinction is what makes this safe to save next to unrelated
 * edits: an operator changing a company's status must not silently drop an
 * override somebody granted last month just because their copy of the form was
 * rendered without it. Same shape as the `…Unlimited` companions the limit
 * fields already use.
 *
 * A control that posted nothing at all is not a decision either — every other
 * caller of this action leaves the whole set alone.
 */
function readFeatureChanges(formData: FormData): FeatureChange[] {
  const changes: FeatureChange[] = [];
  for (const feature of PLAN_FEATURES) {
    const choice = formData.get(`feature_${feature}`);
    if (typeof choice !== 'string') continue;
    if (choice === formData.get(`feature_${feature}_was`)) continue;
    if (choice === 'on') changes.push({ feature, value: true });
    else if (choice === 'off') changes.push({ feature, value: false });
    else if (choice === 'inherit') changes.push({ feature, value: null });
  }
  return changes;
}

/**
 * The stored blob, reduced to the entries this release understands.
 *
 * `feature_overrides` has been hand-edited with SQL until now, so it can hold a
 * misspelled name or a string `"true"`. `src/lib/entitlements.ts` already
 * ignores anything that is not a boolean under a known feature name when it
 * reads; dropping the same junk on write is what lets an operator clear the last
 * real exception and get an honest `null` back rather than a blob of leftovers
 * that reads as "this company has exceptions" forever.
 */
function normalizeStoredOverrides(value: unknown): PlanFeatureSet {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const overrides: PlanFeatureSet = {};
  for (const feature of PLAN_FEATURES) {
    const entry = raw[feature];
    if (typeof entry === 'boolean') overrides[feature] = entry;
  }
  return overrides;
}

export async function updateSubscriptionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireRole([ROLES.SUPER_ADMIN]);
  const parsed = subSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const v = parsed.data;
  const sb = createSupabaseServiceClient();

  // Plan defaults come from `billing_plans` (the editable source of record), and
  // fall back to the static catalogue only for keys that predate that table.
  const { data: planRow, error: planErr } = await sb
    .from('billing_plans')
    .select('message_limit,bot_limit,agent_limit,integration_limit')
    .eq('key', v.plan)
    .maybeSingle();
  if (planErr) return { error: `Could not read the plan defaults: ${planErr.message}` };
  const fallback = v.plan in PLANS ? PLANS[v.plan as keyof typeof PLANS] : null;
  const p = (planRow ?? {}) as Record<string, unknown>;
  const planDefaults = {
    messageLimit: planRow ? (p.message_limit as number | null) : (fallback?.messageLimit ?? null),
    botLimit: planRow ? (p.bot_limit as number | null) : (fallback?.botLimit ?? null),
    agentLimit: planRow ? (p.agent_limit as number | null) : (fallback?.agentLimit ?? null),
    integrationLimit: planRow
      ? (p.integration_limit as number | null)
      : (fallback?.integrationLimit ?? null),
  };

  const limits = {
    message_limit: resolveLimit(v.messageLimit, v.messageLimitUnlimited, planDefaults.messageLimit),
    agent_limit: resolveLimit(v.agentLimit, v.agentLimitUnlimited, planDefaults.agentLimit),
    bot_limit: resolveLimit(v.botLimit, v.botLimitUnlimited, planDefaults.botLimit),
    integration_limit: resolveLimit(
      v.integrationLimit,
      v.integrationLimitUnlimited,
      planDefaults.integrationLimit,
    ),
  };

  // Migration 0065 — the per-company exceptions `src/lib/entitlements.ts` reads.
  // `undefined` means the column is left out of the update entirely, which is
  // the case for every save where no exception control moved: the merge below
  // is the only thing that may rewrite somebody else's grant, so it runs only
  // when this operator actually decided something.
  let featureOverrides: PlanFeatureSet | null | undefined;
  const featureChanges = readFeatureChanges(formData);
  if (featureChanges.length > 0) {
    const { data: currentRow, error: currentErr } = await sb
      .from('subscriptions')
      .select('feature_overrides')
      .eq('company_id', v.companyId)
      .maybeSingle();
    if (currentErr) {
      return { error: `Could not read the current feature exceptions: ${currentErr.message}` };
    }
    const merged = normalizeStoredOverrides(
      (currentRow as { feature_overrides?: unknown } | null)?.feature_overrides,
    );
    for (const change of featureChanges) {
      if (change.value === null) delete merged[change.feature];
      else merged[change.feature] = change.value;
    }
    // `null`, not `{}`, once the last exception is cleared: 0065 keeps the two
    // apart so the table still reads as "this company has no exceptions".
    featureOverrides = Object.keys(merged).length > 0 ? merged : null;
  }

  const { error: updateErr } = await sb
    .from('subscriptions')
    .update({
      plan: v.plan,
      status: v.status,
      free_until: v.freeUntil ?? null,
      ...limits,
      ...(featureOverrides === undefined ? {} : { feature_overrides: featureOverrides }),
    })
    .eq('company_id', v.companyId);
  if (updateErr) return { error: `Could not save the subscription: ${updateErr.message}` };

  await writeAudit(sb, {
    companyId: v.companyId,
    actorId: admin.userId,
    action: 'subscription.updated',
    targetType: 'subscription',
    targetId: v.companyId,
    metadata: {
      plan: v.plan,
      status: v.status,
      freeUntil: v.freeUntil ?? null,
      messageLimit: limits.message_limit,
      agentLimit: limits.agent_limit,
      botLimit: limits.bot_limit,
      integrationLimit: limits.integration_limit,
      // Only recorded when it moved, so the log says who granted a feature and
      // when rather than repeating the same blob on every unrelated plan edit.
      ...(featureOverrides === undefined ? {} : { featureOverrides }),
    },
  });
  revalidatePath(`/super-admin/companies/${v.companyId}`);
  // `/manage` renders the same `getCompanyDetail(id)` payload as the detail page.
  revalidatePath(`/super-admin/companies/${v.companyId}/manage`);
  revalidatePath('/super-admin/subscriptions');
  return {};
}

/** Email a company's "how to improve" report to its admins — super-admin only. */
const creditTopUpSchema = z.object({
  companyId: z.string().uuid(),
  amount: z.coerce.number().positive('Credit amount must be greater than zero'),
  description: optText,
});

export async function topUpCompanyCreditAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireRole([ROLES.SUPER_ADMIN]);
  const parsed = creditTopUpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const v = parsed.data;
  const sb = createSupabaseServiceClient();

  const { data: account, error: readErr } = await sb
    .from('company_credit_accounts')
    .select('balance_amount,lifetime_credit_added')
    .eq('company_id', v.companyId)
    .maybeSingle();
  if (readErr) return { error: `Could not read the credit wallet: ${readErr.message}` };

  const nextBalance = Number(account?.balance_amount ?? 0) + v.amount;
  const nextLifetime = Number(account?.lifetime_credit_added ?? 0) + v.amount;

  const { error: upsertErr } = await sb.from('company_credit_accounts').upsert({
    company_id: v.companyId,
    currency: 'GBP',
    balance_amount: nextBalance,
    lifetime_credit_added: nextLifetime,
    low_balance_threshold: 2,
  });
  if (upsertErr) return { error: `Could not credit the wallet: ${upsertErr.message}` };

  const { error: txErr } = await sb.from('company_credit_transactions').insert({
    company_id: v.companyId,
    type: 'top_up',
    amount: v.amount,
    currency: 'GBP',
    description: v.description ?? 'Manual AI credit top-up',
    created_by: admin.userId,
  });
  if (txErr) {
    // The balance moved but the ledger did not. Say so loudly: a silent gap here
    // makes the wallet impossible to reconcile.
    return {
      error: `Balance updated but the ledger entry failed: ${txErr.message}. Reconcile before topping up again.`,
    };
  }
  await writeAudit(sb, {
    companyId: v.companyId,
    actorId: admin.userId,
    action: 'credit.top_up',
    targetType: 'company_credit_account',
    targetId: v.companyId,
    metadata: { amountGbp: v.amount, description: v.description ?? null },
  });
  revalidatePath(`/super-admin/companies/${v.companyId}`);
  revalidatePath(`/super-admin/companies/${v.companyId}/manage`);
  revalidatePath('/super-admin/usage');
  return {};
}

const replyGrantSchema = z.object({
  companyId: z.string().uuid(),
  replyCount: z.coerce.number().int().positive('Reply count must be greater than zero'),
  grantType: z
    .enum(['manual', 'goodwill', 'paid_extra', 'support_adjustment'])
    .default('manual'),
  reason: z.string().trim().min(2, 'Add a short note for this reply grant'),
  expiresAt: optDate,
});

function expiryIso(value: string | undefined): string {
  if (!value) return currentMonthEndIso();
  return new Date(`${value}T23:59:59.999Z`).toISOString();
}

export async function grantCompanyRepliesAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireRole([ROLES.SUPER_ADMIN]);
  const parsed = replyGrantSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const v = parsed.data;
  const sb = createSupabaseServiceClient();
  const expiresAt = expiryIso(v.expiresAt);

  const { data, error } = await sb
    .from('company_reply_grants')
    .insert({
      company_id: v.companyId,
      reply_count: v.replyCount,
      reason: v.reason,
      grant_type: v.grantType,
      expires_at: expiresAt,
      created_by: admin.userId,
    })
    .select('id')
    .single();
  if (error) return { error: `Could not grant the extra replies: ${error.message}` };

  await writeAudit(sb, {
    companyId: v.companyId,
    actorId: admin.userId,
    action: 'replies.granted',
    targetType: 'company_reply_grant',
    targetId: (data?.id as string) ?? v.companyId,
    metadata: {
      replyCount: v.replyCount,
      grantType: v.grantType,
      reason: v.reason,
      expiresAt,
    },
  });
  revalidatePath(`/super-admin/companies/${v.companyId}`);
  revalidatePath(`/super-admin/companies/${v.companyId}/manage`);
  revalidatePath('/super-admin/companies');
  revalidatePath('/super-admin/usage');
  return {};
}

export async function emailImprovementsAction(formData: FormData): Promise<void> {
  const admin = await requireRole([ROLES.SUPER_ADMIN]);
  const companyId = String(formData.get('companyId') ?? '');
  if (!companyId) return;
  const sb = createSupabaseServiceClient();
  try {
    const res = await sendImprovementEmail(companyId);
    await writeAudit(sb, {
      companyId,
      actorId: admin.userId,
      action: 'improvements.emailed',
      targetType: 'company',
      targetId: companyId,
      metadata: { sent: res.sent, reason: res.reason ?? null },
    });
  } catch (err) {
    logger.error('Improvement email failed', {
      companyId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  revalidatePath('/super-admin/quality');
}

/** Run a graded (LLM-judged) evaluation for a company — super-admin only. */
export async function runCompanyGradedEvalAction(formData: FormData): Promise<void> {
  const admin = await requireRole([ROLES.SUPER_ADMIN]);
  const companyId = String(formData.get('companyId') ?? '');
  if (!companyId) return;
  const sb = createSupabaseServiceClient();
  try {
    await runEval(companyId, null, { graded: true });
    await writeAudit(sb, {
      companyId,
      actorId: admin.userId,
      action: 'eval.graded_run',
      targetType: 'company',
      targetId: companyId,
    });
  } catch (err) {
    logger.error('Graded eval failed', {
      companyId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  revalidatePath(`/super-admin/companies/${companyId}`);
  revalidatePath(`/super-admin/companies/${companyId}/manage`);
  revalidatePath('/super-admin/quality');
}

/**
 * Permanently delete a company and everything belonging to it.
 *
 * The data itself needs no orchestration: all 108 `company_id` foreign keys are
 * `on delete cascade`, so removing the `companies` row removes conversations,
 * messages, leads, documents, bots, orders, settings and the rest in one
 * statement. What does need care is everything the cascade cannot reach.
 *
 * Login accounts. `public.users` has no foreign key to `companies` — the link is
 * `company_users`, and only that join row cascades. Deleting a company would
 * otherwise leave people able to sign in to nothing. So the members are
 * classified BEFORE the delete (afterwards the membership rows are gone) and
 * the ones who exist solely for this company are removed from auth as well.
 * A member who is a platform super admin, or who belongs to another company,
 * keeps their login — removing it would take away access they still need.
 *
 * The audit record. `audit_logs.company_id` is `on delete set null`, so the row
 * survives the cascade but loses the only thing identifying it. The company id
 * and name therefore go into the metadata, where they cannot be nulled.
 */
export async function deleteCompanyAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireRole([ROLES.SUPER_ADMIN]);
  const sb = createSupabaseServiceClient();

  const parsed = z
    .object({
      companyId: z.string().uuid('Pick a company'),
      confirmation: z.string(),
    })
    .safeParse({
      companyId: formData.get('companyId'),
      confirmation: formData.get('confirmation'),
    });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Could not read the form' };
  }

  // Typing the word is the whole safeguard. Accept it with stray spaces or a
  // capital D, and nothing else.
  if (parsed.data.confirmation.trim().toLowerCase() !== 'delete') {
    return { error: 'Type delete to confirm. Nothing has been removed.' };
  }

  const { data: company } = await sb
    .from('companies')
    .select('id,name')
    .eq('id', parsed.data.companyId)
    .maybeSingle();
  if (!company) return { error: 'That company no longer exists.' };
  const target = company as { id: string; name: string };

  // Must happen first: company_users is cascaded away by the delete below.
  const { data: memberRows } = await sb
    .from('company_users')
    .select('user_id,role')
    .eq('company_id', target.id);
  const fates = await classifyMembers(
    sb,
    target.id,
    (memberRows ?? []) as { user_id: string; role: string }[],
  );
  const loginsToRemove = fates
    .filter((u) => u.fate === 'delete')
    .map((u) => ({ id: u.id, email: u.email }))
    // Belt and braces: whoever is doing the deleting never loses their own login.
    .filter((u) => u.id !== admin.userId);

  const { error: deleteError } = await sb.from('companies').delete().eq('id', target.id);
  if (deleteError) {
    return { error: `Could not delete the company: ${deleteError.message}` };
  }

  // The company is gone from here on. A failure below leaves an orphaned login,
  // which is recoverable and logged — so it must not abort or be reported as a
  // failed deletion.
  const removedLogins: string[] = [];
  const failedLogins: string[] = [];
  for (const login of loginsToRemove) {
    const { error: authError } = await sb.auth.admin.deleteUser(login.id);
    if (authError) {
      failedLogins.push(login.email);
      logger.error('Could not delete a login after removing its company', {
        userId: login.id,
        error: authError.message,
      });
      continue;
    }
    // `public.users` is a separate table with no cascade from auth.
    await sb.from('users').delete().eq('id', login.id);
    removedLogins.push(login.email);
  }

  await writeAudit(sb, {
    // Not target.id: the row is gone, and the foreign key would reject it.
    companyId: null,
    actorId: admin.userId,
    action: 'company.deleted',
    targetType: 'company',
    targetId: target.id,
    metadata: {
      companyName: target.name,
      companyId: target.id,
      loginsRemoved: removedLogins,
      loginsKept: fates.filter((u) => u.fate === 'keep').map((u) => ({
        email: u.email,
        reason: u.keptBecause,
      })),
      loginsFailed: failedLogins,
    },
  });

  logger.warn('Company deleted', {
    companyId: target.id,
    actorId: admin.userId,
    loginsRemoved: removedLogins.length,
  });

  revalidatePath('/super-admin/companies');
  revalidatePath('/super-admin');

  if (failedLogins.length) {
    return {
      error: `${target.name} was deleted, but these logins could not be removed and still exist: ${failedLogins.join(', ')}`,
    };
  }
  redirect('/super-admin/companies');
}

/**
 * What deleting a company would destroy, fetched when the confirmation opens.
 *
 * Deliberately not computed for every row of the companies list: the preview
 * runs six counts and two membership reads per company, which is wasted work on
 * a page where most rows will never be deleted.
 */
export async function companyDeletionPreviewAction(
  companyId: string,
): Promise<CompanyDeletionPreview | null> {
  await requireRole([ROLES.SUPER_ADMIN]);
  return getCompanyDeletionPreview(companyId);
}
