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
import { applyCreditMovement, resolveIncludedCredit } from '@/lib/billing/credits';
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

/**
 * Record what an operator just did. Returns a sentence when the record could not
 * be written, and `null` when it could.
 *
 * WHY THIS RETURNS INSTEAD OF THROWING, AND WHY IT NEVER BLOCKS
 * ------------------------------------------------------------
 * The insert error used to be discarded, so a super-admin could grant a company
 * any package for nothing and leave no trace of who did it or what it replaced.
 * That is precisely the class of action an audit trail exists for, and a silent
 * failure is worse than a noisy one.
 *
 * It still does not abort the operation, deliberately. Every caller writes its
 * audit row AFTER the thing it describes has already been applied — the
 * subscription is written, the wallet is funded, the company is deleted. Failing
 * the action at that point would not undo any of it; it would tell the operator
 * their change did not happen when it did, and the predictable next move is to
 * do it again. That is how a comp gets applied twice and a wallet funded twice.
 * Ordering the audit first instead is not an improvement either: it would record
 * changes that then failed, and an audit trail that lies in the other direction
 * is no more use.
 *
 * So the failure is made loud rather than fatal: the whole entry goes to the
 * logger (the record survives there even when the table write does not), and the
 * caller reports it to the operator in an "it happened, but…" shape — with the
 * crucial instruction not to retry.
 */
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
): Promise<string | null> {
  const { error } = await sb.from('audit_logs').insert({
    company_id: entry.companyId ?? null,
    actor_user_id: entry.actorId ?? null,
    action: entry.action,
    target_type: entry.targetType ?? null,
    target_id: entry.targetId ?? null,
    metadata_json: entry.metadata ?? {},
  });
  if (!error) return null;
  logger.error('Could not write an audit record for a super-admin action', {
    action: entry.action,
    companyId: entry.companyId ?? undefined,
    actorId: entry.actorId ?? null,
    entry: entry.metadata ?? {},
    error: error.message,
  });
  return `it was not recorded in the audit log (${error.message}). The change IS applied — do not repeat it.`;
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
  // The company was inserted moments ago, so this cannot land on an existing row
  // and cannot clobber an operator's threshold the way the top-up path did. The
  // hardcoded threshold is still dropped: the column default (2, migration 0024)
  // is the one place that number should live, so raising it later does not mean
  // hunting for copies in the onboarding paths.
  const { error: creditErr } = await sb.from('company_credit_accounts').upsert({
    company_id: company.id,
    currency: 'GBP',
    balance_amount: startingCredit,
    lifetime_credit_added: startingCredit,
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
  const auditNote = await writeAudit(sb, {
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
  // The company, its admin and its wallet all exist and work. Only the record of
  // who set it up is missing, so this reports rather than redirects — and it
  // leads with the fact the company WAS created, because the alternative
  // reading ("it failed, try again") produces a duplicate tenant.
  if (auditNote) return { error: `${v.name} was created, but ${auditNote}` };
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

  // `.select()` on the update, and a length check on what comes back: PostgREST
  // reports NO error for an update that matched nothing, so checking only the
  // error reports success for a company that has since been deleted. Same shape
  // as `updateSubscriptionAction` below — see the note there.
  const { data: companyRows, error: companyErr } = await sb
    .from('companies')
    .update({ status: v.status })
    .eq('id', v.companyId)
    .select('id');
  if (companyErr) return { error: `Could not update the company: ${companyErr.message}` };
  if (!companyRows || companyRows.length === 0) {
    return { error: 'That company no longer exists. Nothing was changed.' };
  }

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
    const { data: subRows, error: subErr } = await sb
      .from('subscriptions')
      .update({ status: subscriptionStatus })
      .eq('company_id', v.companyId)
      .select('company_id');
    if (subErr || !subRows || subRows.length === 0) {
      return {
        error: `Company set to ${v.status}, but its subscription could not be updated: ${
          subErr?.message ?? 'no subscription row matched this company'
        }`,
      };
    }
  }

  const auditNote = await writeAudit(sb, {
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
  if (auditNote) return { error: `The company was set to ${v.status}, but ${auditNote}` };
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
  /**
   * Money, so `optMoney` rather than `optNum` — this one has pence, and the
   * column (`numeric(12,2)`, migration 0093) stores them.
   */
  includedCreditGbp: optMoney,
  /** What the control above was DRAWN with. See `readIncludedCreditChange`. */
  includedCreditGbpWas: optText,
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

/**
 * Round to the four decimal places `company_credit_accounts.balance_amount`
 * (`numeric(12,4)`, migration 0024) actually stores, so the figure written and
 * the figure read back are the same one.
 */
function roundMoney(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * The per-company included-credit figure this submit DECIDED, or `undefined`
 * when the operator did not touch the control.
 *
 * Same `_was` companion the feature exceptions use, and for the same reason: a
 * field that comes back exactly as it was DRAWN is not a decision, so the column
 * is left out of the update entirely. Treating "blank" as a decision would mean
 * an operator changing this company's status quietly wiping a number somebody
 * agreed with the customer.
 *
 * An earlier draft of this comment justified the guard by saying the page never
 * passed the stored figure in, so the box always opened empty. That was true when
 * it was written and is not any more — the detail page now hands the form
 * `subscriptions.included_credit_gbp` and the box opens on the negotiated figure.
 * The guard is not made redundant by that, it is made load-bearing BY it: now
 * that the box can open non-empty, `_was` is the only thing that distinguishes
 * "the operator retyped the same number" from "the operator never touched it",
 * and both have to leave the column alone. Do not remove it on the strength of
 * the old reasoning.
 *
 * `null` means the operator cleared it — inherit the package.
 */
function readIncludedCreditChange(
  formData: FormData,
  parsed: number | undefined,
): number | null | undefined {
  const now = formData.get('includedCreditGbp');
  if (typeof now !== 'string') return undefined;
  const was = formData.get('includedCreditGbpWas');
  if (now.trim() === (typeof was === 'string' ? was.trim() : '')) return undefined;
  return parsed ?? null;
}

interface WalletTopUp {
  topped: boolean;
  from: number;
  to: number;
  /** Set when the money did not move, or moved without its ledger row. */
  error?: string;
}

/**
 * Bring a company's AI wallet up to what its new package includes.
 *
 * WHY A COMP NEEDS THIS AT ALL
 * ----------------------------
 * Three independent gates stand in front of a widget reply
 * (`src/app/api/chat/route.ts`), and the third is the prepaid wallet: a reply is
 * allowed only while `company_credit_accounts.balance_amount` is above zero.
 * Setting a package and its limits therefore does not, on its own, make a
 * company able to answer anybody. An operator comping a company to Pro used to
 * get a screen saying Pro, active, 5,000 replies allowed, 200 used — while the
 * assistant was silent because the wallet had been empty since the month the
 * company's original credit ran out. The comp looked perfect and the product was
 * dead. Granting the package and funding the wallet are one operator decision,
 * so they are one code path.
 *
 * WHY NOT `replenishMonthlyCredit`
 * --------------------------------
 * `src/lib/billing/credits.ts` has exactly this shape and is the right thing for
 * the monthly cadence, but it cannot serve this case. It is idempotent per UTC
 * month, locked by the `included_credit` ledger row and migration 0089's unique
 * index over it — so an operator moving a company from Starter (£7 included) to
 * Pro (£242) on the 20th, after the month's grant has already run, would get
 * nothing at all, which is the exact failure being fixed here. And if it did
 * run, it would consume that month's single `included_credit` slot, so the
 * plan change would silently cancel the replenishment. Hence a `top_up` row:
 * this is an operator's grant, not the monthly allowance, the two are separate
 * facts in the ledger, and neither can eat the other.
 *
 * TOP UP TO, NOT BY — the same doctrine as the monthly job. A company that
 * already holds more than the package includes keeps every penny and gets
 * nothing extra, so this can never be used to stack credit by re-saving the
 * form.
 */
async function fundWalletForPlan(params: {
  companyId: string;
  plan: string;
  includedCredit: number;
  actorId: string;
}): Promise<WalletTopUp> {
  const { companyId, plan, actorId } = params;
  const included = roundMoney(params.includedCredit);
  if (!Number.isFinite(included) || included <= 0) return { topped: false, from: 0, to: 0 };

  // One statement, in the database: the ledger row and the balance move together
  // under a row lock, or neither does. This used to read the balance here, write
  // `balance_amount = included` back, and hope nothing landed in between — which
  // meant a top-up the customer had just bought could be overwritten by an
  // operator saving this form, with the `top_up` row still on the books saying
  // it had been added. `apply_credit_movement` (migration 0093) removes the gap,
  // and the "brought UP TO, never past" rule now lives in the SQL, so re-saving
  // the form still cannot stack credit.
  const movement = await applyCreditMovement({
    companyId,
    type: 'top_up',
    toBalance: included,
    description: `AI credit brought up to the ${plan} package allowance (£${included.toFixed(2)})`,
    createdBy: actorId,
    metadata: { plan, includedCreditGbp: included, source: 'plan_change' },
  });

  if (movement.status === 'failed') {
    return {
      topped: false,
      from: 0,
      to: 0,
      error: `the AI credit could not be applied, so the wallet was not funded (${
        movement.error ?? 'unknown error'
      }). Check the company's credit before changing the package again.`,
    };
  }
  // `no_account` — credit is not tracked for this company at all
  // (`getAiCreditAccess` lets those replies through), so there is nothing to
  // fund and nothing is silently created. `no_change` — the wallet already
  // holds more than the package includes and keeps every penny of it.
  if (movement.status !== 'applied') {
    return { topped: false, from: movement.balanceBefore, to: movement.balanceAfter };
  }
  return { topped: true, from: movement.balanceBefore, to: movement.balanceAfter };
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

  // ONE read of the row about to be changed, before anything is written. It
  // answers three questions at once: whether the row exists at all, what package
  // was on it (so the wallet is funded only when the package really moves, and
  // so the audit records what this replaced), and which feature exceptions it
  // already carries.
  //
  // The existence check is the important one. PostgREST returns NO error for an
  // UPDATE that matched zero rows, so comping a company with no `subscriptions`
  // row used to clear the form, write an audit entry saying it worked, and
  // change nothing whatsoever.
  const { data: currentRow, error: currentErr } = await sb
    .from('subscriptions')
    .select('plan,status,feature_overrides,included_credit_gbp')
    .eq('company_id', v.companyId)
    .maybeSingle();
  if (currentErr) {
    return { error: `Could not read the current subscription: ${currentErr.message}` };
  }
  if (!currentRow) {
    return {
      error:
        'This company has no subscription record, so there is nothing to change. Every company gets one at onboarding — this one needs repairing before a package can be set.',
    };
  }
  const current = currentRow as Record<string, unknown>;
  const previousPlan = (current.plan as string) ?? null;
  const previousStatus = (current.status as string) ?? null;
  const storedIncludedCredit =
    current.included_credit_gbp == null ? null : Number(current.included_credit_gbp);

  // Plan defaults come from `billing_plans` (the editable source of record), and
  // fall back to the static catalogue only for keys that predate that table.
  const { data: planRow, error: planErr } = await sb
    .from('billing_plans')
    .select('message_limit,bot_limit,agent_limit,integration_limit,included_credit_gbp')
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

  // The fifth limit, and the one that had nowhere to live until migration 0093.
  // `undefined` keeps the column out of the update entirely — see
  // `readIncludedCreditChange` — so an unrelated save cannot wipe a negotiated
  // figure the form was not given.
  const includedCreditChange = readIncludedCreditChange(formData, v.includedCreditGbp);
  const includedCreditOverride =
    includedCreditChange === undefined ? storedIncludedCredit : includedCreditChange;
  // The same resolution `replenishMonthlyCredit` will use next month, so the
  // wallet an operator funds today and the wallet the cron tops up in three
  // weeks agree. `custom` reaches the uncapped-plan floor here rather than the
  // zero its catalogue row holds, which is what makes comping to `custom`
  // actually fund anything.
  const includedCredit = resolveIncludedCredit({
    perCompany: includedCreditOverride,
    catalogue: planRow ? Number(p.included_credit_gbp ?? 0) : null,
    mapped: fallback?.includedCreditGbp,
    messageLimit: limits.message_limit,
  });

  // Migration 0065 — the per-company exceptions `src/lib/entitlements.ts` reads.
  // `undefined` means the column is left out of the update entirely, which is
  // the case for every save where no exception control moved: the merge below
  // is the only thing that may rewrite somebody else's grant, so it runs only
  // when this operator actually decided something.
  let featureOverrides: PlanFeatureSet | null | undefined;
  const featureChanges = readFeatureChanges(formData);
  if (featureChanges.length > 0) {
    const merged = normalizeStoredOverrides(current.feature_overrides);
    for (const change of featureChanges) {
      if (change.value === null) delete merged[change.feature];
      else merged[change.feature] = change.value;
    }
    // `null`, not `{}`, once the last exception is cleared: 0065 keeps the two
    // apart so the table still reads as "this company has no exceptions".
    featureOverrides = Object.keys(merged).length > 0 ? merged : null;
  }

  // `.select()` on the update so a zero-row result can be told apart from a
  // successful one. The row was read at the top of this action, so nothing
  // matching here means it was deleted in between — rare, but the alternative is
  // a form that clears, an audit entry that says the comp was applied, and a
  // company still on its old package.
  const { data: updatedRows, error: updateErr } = await sb
    .from('subscriptions')
    .update({
      plan: v.plan,
      status: v.status,
      free_until: v.freeUntil ?? null,
      ...limits,
      ...(includedCreditChange === undefined ? {} : { included_credit_gbp: includedCreditChange }),
      ...(featureOverrides === undefined ? {} : { feature_overrides: featureOverrides }),
    })
    .eq('company_id', v.companyId)
    .select('company_id');
  if (updateErr) return { error: `Could not save the subscription: ${updateErr.message}` };
  if (!updatedRows || updatedRows.length === 0) {
    return {
      error:
        'Nothing was saved: this company no longer has a subscription record. Reload the page before trying again.',
    };
  }

  // Granting a package and funding the wallet it needs are one decision, so they
  // happen together — see `fundWalletForPlan`. Only when the entitlement
  // actually MOVES: topping up on every save would let an operator refill a
  // spent wallet by pressing save repeatedly, and the same-package case is what
  // the manual top-up control and the monthly replenishment are for.
  //
  // A changed included-credit figure counts as a move as well as a changed
  // package. Raising it on a company that stays on `custom` is the commonest
  // negotiated change there is, and leaving the wallet on last month's figure
  // until the cron next runs would put the operator right back where this whole
  // change started — a screen that says one thing and an assistant that cannot
  // answer. "Up TO, never past" still means a re-save with nothing changed
  // cannot stack credit even when this does fire.
  const entitlementMoved =
    previousPlan !== v.plan ||
    (includedCreditChange !== undefined && includedCreditChange !== storedIncludedCredit);
  const wallet: WalletTopUp = entitlementMoved
    ? await fundWalletForPlan({
        companyId: v.companyId,
        plan: v.plan,
        includedCredit: includedCredit,
        actorId: admin.userId,
      })
    : { topped: false, from: 0, to: 0 };

  const auditNote = await writeAudit(sb, {
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
      // Both figures, because they answer different questions: the override is
      // what this operator decided (null = follow the package), the resolved
      // figure is what the company will actually be funded to — and for a comp
      // to `custom` those differ, since the resolved one comes from the
      // uncapped-plan floor rather than from anything anybody typed.
      includedCreditOverrideGbp: includedCreditOverride,
      includedCreditGbp: includedCredit,
      // What this replaced. A comp overwrites whatever an operator set before it,
      // and the entry is the only place that answer survives.
      previousPlan,
      previousStatus,
      previousIncludedCreditOverrideGbp: storedIncludedCredit,
      ...(wallet.topped ? { creditToppedUpToGbp: wallet.to, creditBeforeGbp: wallet.from } : {}),
      // Only recorded when it moved, so the log says who granted a feature and
      // when rather than repeating the same blob on every unrelated plan edit.
      ...(featureOverrides === undefined ? {} : { featureOverrides }),
    },
  });
  revalidatePath(`/super-admin/companies/${v.companyId}`);
  // `/manage` renders the same `getCompanyDetail(id)` payload as the detail page.
  revalidatePath(`/super-admin/companies/${v.companyId}/manage`);
  revalidatePath('/super-admin/subscriptions');
  revalidatePath('/super-admin/usage');
  // Both of these report something that happened AFTER the package was saved, so
  // both lead with the save having worked: an operator who reads this as a
  // failure and applies the comp again is the outcome to avoid.
  if (wallet.error) return { error: `The package was saved, but ${wallet.error}` };
  if (auditNote) return { error: `The package was saved, but ${auditNote}` };
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

  /*
   * The wallet row has to EXIST before the movement, because
   * `apply_credit_movement` deliberately creates nothing: "no wallet row" means
   * credit is not tracked for this company and `getAiCreditAccess` lets its
   * replies through, so no other caller may invent one. Support adding credit by
   * hand is the one place that decision is being taken, and it was taken here
   * before (the old code upserted the row), so it is kept.
   *
   * `ignoreDuplicates` makes this INSERT ... ON CONFLICT DO NOTHING, so a
   * company that already has a wallet is not touched at all — the balance is
   * moved by the statement below and nothing here can overwrite it.
   *
   * `low_balance_threshold` is deliberately NOT in this payload. PostgREST
   * writes exactly the columns present, so writing 2 here reset the threshold on
   * EVERY manual top-up — including for a company whose threshold an operator
   * had raised by hand. That used to be invisible because nothing read the
   * column outside a read-only panel; it is now the trigger for the low-credit
   * warning in `@/lib/billing/usage-alerts`, so clobbering it takes away the
   * early warning of exactly the company support just had to top up. Omitting it
   * lets a first-ever row take the column default (2, migration 0024), which is
   * the same number this line was hardcoding — one definition instead of three.
   */
  const { error: walletErr } = await sb
    .from('company_credit_accounts')
    .upsert({ company_id: v.companyId, currency: 'GBP' }, { onConflict: 'company_id', ignoreDuplicates: true });
  if (walletErr) return { error: `Could not open the credit wallet: ${walletErr.message}` };

  /*
   * This was the last wallet writer still doing its arithmetic in JavaScript:
   * read `balance_amount` and `lifetime_credit_added`, add, write both back
   * absolutely, then insert the ledger row as a separate statement. Both halves
   * of that were wrong in the way migration 0093 exists to fix. The absolute
   * write destroyed anything that landed in the gap — an AI deduction, the
   * monthly replenishment, an auto top-up the customer had just paid for — and
   * the separate ledger insert could fail after the money had already moved,
   * which is why this function used to have a "balance updated but the ledger
   * entry failed, reconcile before topping up again" branch. There is no such
   * state to report now: the ledger row and the balance are one statement under
   * a row lock, so either both happened or neither did.
   *
   * A signed `amount` rather than `toBalance`: this is money being ADDED to
   * whatever is there, not a package allowance being restored, so it must stack
   * on the balance the database is holding.
   */
  const movement = await applyCreditMovement({
    companyId: v.companyId,
    type: 'top_up',
    amount: v.amount,
    description: v.description ?? 'Manual AI credit top-up',
    createdBy: admin.userId,
    metadata: { source: 'super_admin_manual' },
  });
  if (movement.status !== 'applied') {
    // Nothing moved and nothing was written, so this is safe to retry — which is
    // the opposite of what the old half-applied state could be told to do.
    const detail =
      movement.status === 'no_account'
        ? 'this company has no credit wallet'
        : (movement.error ?? `the wallet returned ${movement.status}`);
    return { error: `No credit was added (${detail}). Nothing was written, so it is safe to try again.` };
  }
  const auditNote = await writeAudit(sb, {
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
  if (auditNote) return { error: `£${v.amount} of credit was added, but ${auditNote}` };
  return {};
}

const replyGrantSchema = z.object({
  companyId: z.string().uuid(),
  replyCount: z.coerce.number().int().positive('Reply count must be greater than zero'),
  grantType: z.enum(['manual', 'goodwill', 'paid_extra', 'support_adjustment']).default('manual'),
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

  const auditNote = await writeAudit(sb, {
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
  if (auditNote) {
    return { error: `The ${v.replyCount} extra replies were granted, but ${auditNote}` };
  }
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

  const auditNote = await writeAudit(sb, {
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
      loginsKept: fates
        .filter((u) => u.fate === 'keep')
        .map((u) => ({
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

  if (failedLogins.length || auditNote) {
    // Both halves of this are reported together, and both lead with the deletion
    // having happened: it cannot be undone, so the one thing the operator must
    // not do is try again.
    const problems = [
      failedLogins.length
        ? `these logins could not be removed and still exist: ${failedLogins.join(', ')}`
        : null,
      // The audit entry is the ONLY surviving record of a destruction this
      // irreversible — the rows it describes are gone — so a failure to write it
      // is worth stopping the operator on rather than a line in a log file.
      auditNote,
    ].filter((problem): problem is string => problem !== null);
    return { error: `${target.name} was deleted, but ${problems.join(', and ')}` };
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
