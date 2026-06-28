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
import { sendImprovementEmail } from './improvements-data';
import { PLANS, PLAN_KEYS, SUBSCRIPTION_STATUSES } from './plans';

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

const optNum = z.preprocess(
  (x) => (x === '' || x == null ? undefined : x),
  z.coerce.number().int().positive().optional(),
);
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
  overageEnabled: z.preprocess((x) => x === 'on', z.boolean()).default(false),
  overageUnitPrice: optMoney,
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
    overage_enabled: v.overageEnabled,
    overage_unit_price: v.overageUnitPrice ?? null,
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
  if (mErr) return { error: 'Company created but linking admin failed: ' + mErr.message };

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
      overageEnabled: v.overageEnabled,
      overageUnitPrice: v.overageUnitPrice ?? null,
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

export async function setCompanyStatusAction(formData: FormData): Promise<void> {
  const admin = await requireRole([ROLES.SUPER_ADMIN]);
  const v = statusSchema.parse(Object.fromEntries(formData));
  const sb = createSupabaseServiceClient();

  await sb.from('companies').update({ status: v.status }).eq('id', v.companyId);
  if (v.status === 'suspended') {
    await sb.from('subscriptions').update({ status: 'suspended' }).eq('company_id', v.companyId);
  }
  await writeAudit(sb, {
    companyId: v.companyId,
    actorId: admin.userId,
    action: v.status === 'suspended' ? 'company.suspended' : 'company.activated',
    targetType: 'company',
    targetId: v.companyId,
  });
  revalidatePath(`/super-admin/companies/${v.companyId}`);
  revalidatePath('/super-admin/companies');
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
  agentLimit: optNum,
  botLimit: optNum,
  integrationLimit: optNum,
});

export async function updateSubscriptionAction(formData: FormData): Promise<void> {
  const admin = await requireRole([ROLES.SUPER_ADMIN]);
  const v = subSchema.parse(Object.fromEntries(formData));
  const sb = createSupabaseServiceClient();

  await sb
    .from('subscriptions')
    .update({
      plan: v.plan,
      status: v.status,
      free_until: v.freeUntil ?? null,
      message_limit: v.messageLimit ?? null,
      agent_limit: v.agentLimit ?? null,
      bot_limit: v.botLimit ?? null,
      integration_limit: v.integrationLimit ?? null,
    })
    .eq('company_id', v.companyId);

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
      messageLimit: v.messageLimit ?? null,
      agentLimit: v.agentLimit ?? null,
      botLimit: v.botLimit ?? null,
      integrationLimit: v.integrationLimit ?? null,
    },
  });
  revalidatePath(`/super-admin/companies/${v.companyId}`);
  revalidatePath('/super-admin/subscriptions');
}

/** Email a company's "how to improve" report to its admins — super-admin only. */
const creditTopUpSchema = z.object({
  companyId: z.string().uuid(),
  amount: z.coerce.number().positive('Credit amount must be greater than zero'),
  description: optText,
});

export async function topUpCompanyCreditAction(formData: FormData): Promise<void> {
  const admin = await requireRole([ROLES.SUPER_ADMIN]);
  const v = creditTopUpSchema.parse(Object.fromEntries(formData));
  const sb = createSupabaseServiceClient();

  const { data: account } = await sb
    .from('company_credit_accounts')
    .select('balance_amount,lifetime_credit_added')
    .eq('company_id', v.companyId)
    .maybeSingle();

  const nextBalance = Number(account?.balance_amount ?? 0) + v.amount;
  const nextLifetime = Number(account?.lifetime_credit_added ?? 0) + v.amount;

  await sb.from('company_credit_accounts').upsert({
    company_id: v.companyId,
    currency: 'GBP',
    balance_amount: nextBalance,
    lifetime_credit_added: nextLifetime,
    low_balance_threshold: 2,
  });
  await sb.from('company_credit_transactions').insert({
    company_id: v.companyId,
    type: 'top_up',
    amount: v.amount,
    currency: 'GBP',
    description: v.description ?? 'Manual AI credit top-up',
    created_by: admin.userId,
  });
  await writeAudit(sb, {
    companyId: v.companyId,
    actorId: admin.userId,
    action: 'credit.top_up',
    targetType: 'company_credit_account',
    targetId: v.companyId,
    metadata: { amountGbp: v.amount, description: v.description ?? null },
  });
  revalidatePath(`/super-admin/companies/${v.companyId}`);
  revalidatePath('/super-admin/usage');
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

export async function grantCompanyRepliesAction(formData: FormData): Promise<void> {
  const admin = await requireRole([ROLES.SUPER_ADMIN]);
  const v = replyGrantSchema.parse(Object.fromEntries(formData));
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
  if (error) throw error;

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
  revalidatePath('/super-admin/companies');
  revalidatePath('/super-admin/usage');
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
  revalidatePath('/super-admin/quality');
}
