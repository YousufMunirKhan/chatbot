import { ROLES, type SupportedLanguage } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { logger } from '@/lib/logger';
import { PLANS, type PlanDef, type PlanKey } from '@/modules/super-admin/plans';

/**
 * Company provisioning — one tenant, created whole or not at all.
 *
 * A tenant is not a row, it is a set of them: a company, a subscription, an AI
 * budget record, a credit wallet with its opening ledger entry, an auth user,
 * and a membership. The billing enforcement path in `src/lib/billing` reads
 * several of those, and a company missing its subscription reads to that code
 * as uncapped, so a half-created tenant is strictly worse than no tenant — it
 * looks live and meters nothing. Every function here therefore unwinds
 * everything it created the moment a step fails.
 *
 * The sequence below is the super-admin onboarding action's sequence
 * (`src/modules/super-admin/actions.ts`), in the same order, so the two cannot
 * drift into subtly different tenants. That action still carries its own copy
 * with operator-only extras layered on (setup fees, add-ons, per-limit
 * overrides); this module is written so folding it in here is a deletion rather
 * than a rewrite — the operator-specific inputs all have a home in the options
 * below or beside them.
 */

/** How a company came to exist. Mirrors the check on `companies.signup_source` (migration 0067). */
export const SIGNUP_SOURCES = ['operator', 'agency', 'self_serve'] as const;
export type SignupSource = (typeof SIGNUP_SOURCES)[number];

export interface ProvisionCompanyInput {
  companyName: string;
  /**
   * URL segment for the company. Omit it and a deterministic slug is derived
   * from the name, which makes a name already in use a visible collision the
   * caller can report. Operator flows pass their own suffixed slug instead,
   * because an operator onboarding a second "Smith Plumbing" wants it created,
   * not refused.
   */
  slug?: string;
  plan: PlanKey;
  signupSource: SignupSource;
  adminEmail: string;
  adminPassword: string;
  adminName?: string | null;
  defaultLanguage?: SupportedLanguage;
  website?: string | null;
  country?: string | null;
  /** ISO date the free period ends. Defaults to the plan's own trial length. */
  freeUntil?: string | null;
  /** Overrides the plan's included AI credit. */
  initialCreditGbp?: number;
  /** `audit_logs.action` for the row written on success. */
  auditAction: string;
  auditMetadata?: Record<string, unknown>;
}

/**
 * Which input the caller should send the person back to. The signup form shows
 * one message at a time, so this is advisory — the message alone is enough to
 * act on — but it lets a caller focus the offending field.
 */
export type ProvisionFailureField = 'companyName' | 'email' | 'password';

export type ProvisionCompanyResult =
  | { ok: true; companyId: string; userId: string; slug: string }
  | { ok: false; error: string; field?: ProvisionFailureField };

/**
 * Deterministic URL slug. Unlike the super-admin version this adds no random
 * suffix: a self-serve signup wants `/acme-plumbing`, and a clash with an
 * existing company is a thing to tell the person about rather than paper over.
 */
export function companySlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'company';
}

/** Postgres unique-violation. The one insert error here that is a user's problem, not a bug. */
const UNIQUE_VIOLATION = '23505';

/**
 * Turn a Supabase Auth failure into something the person filling in the form
 * can do something about.
 *
 * Matching is on `error.code` (GoTrue's stable machine code) with the message
 * text as a fallback, because self-hosted and older GoTrue builds return the
 * same failures with no code at all and the raw text — "AuthApiError: User
 * already registered" — is not an instruction anyone can follow.
 */
function describeAuthFailure(
  code: string | undefined,
  message: string,
): { error: string; field?: ProvisionFailureField } {
  const text = message.toLowerCase();
  if (code === 'email_exists' || code === 'user_already_exists' || text.includes('already registered')) {
    return {
      error: 'That email address already has an account. Sign in instead, or use the forgotten password link.',
      field: 'email',
    };
  }
  if (code === 'weak_password' || text.includes('password')) {
    return {
      error: `That password was rejected as too weak: ${message}. Try a longer one with a mix of letters, numbers and symbols.`,
      field: 'password',
    };
  }
  if (code === 'email_address_invalid' || code === 'email_address_not_authorized') {
    return { error: 'That email address was rejected. Check it for typos, or try your work address.', field: 'email' };
  }
  if (code === 'signup_disabled') {
    return { error: 'New accounts are not being accepted right now. Please contact support.' };
  }
  return { error: `Could not create your account: ${message}` };
}

/**
 * Create a company and its first company admin, or nothing at all.
 *
 * Safe to call from an unauthenticated context: it performs no permission check
 * of its own, so callers that need one (every operator flow) must do it before
 * calling, and callers that are deliberately open (public signup) must throttle
 * before calling.
 */
export async function provisionCompany(
  input: ProvisionCompanyInput,
): Promise<ProvisionCompanyResult> {
  const sb = createSupabaseServiceClient();
  // Annotated rather than inferred: `PLANS` is a literal object, so the union
  // of its members only carries `trialDays` on the entries that define one.
  const plan: PlanDef = PLANS[input.plan];
  const email = input.adminEmail.trim().toLowerCase();
  const slug = input.slug ?? companySlug(input.companyName);

  // Probed before anything is written. An address already in use is by far the
  // most common way this fails, and finding out at the auth step instead would
  // mean creating a company, a subscription and a wallet purely to delete them
  // again on every mistyped signup.
  const { data: existingUser, error: existingUserError } = await sb
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  if (existingUserError) {
    logger.error('Signup email probe failed', {
      module: 'onboarding',
      error: existingUserError.message,
    });
    return { ok: false, error: 'Could not check that email address just now. Please try again.' };
  }
  if (existingUser) {
    return {
      ok: false,
      error: 'That email address already has an account. Sign in instead, or use the forgotten password link.',
      field: 'email',
    };
  }

  // 1. Company
  const { data: company, error: companyError } = await sb
    .from('companies')
    .insert({
      name: input.companyName,
      slug,
      website: input.website ?? null,
      country: input.country ?? null,
      default_language: input.defaultLanguage ?? 'auto',
      signup_source: input.signupSource,
    })
    .select('id')
    .single();
  if (companyError || !company) {
    if (companyError?.code === UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: `A business called “${input.companyName}” is already registered. Add a location or a word that tells yours apart.`,
        field: 'companyName',
      };
    }
    return { ok: false, error: `Could not create the account: ${companyError?.message ?? 'unknown error'}` };
  }
  const companyId = (company as { id: string }).id;

  /**
   * Undo everything created so far. Deleting the company cascades the
   * subscription, budget, wallet, ledger and membership; the auth user and its
   * profile row are separate and have to go explicitly.
   *
   * The super-admin flow deliberately leaves a half-provisioned company behind
   * when the last step fails, because an operator can see the orphan on the
   * companies list and finish it by hand. Nobody is watching when a stranger
   * signs up at 2am, and leaving the auth user in place would burn their email
   * address permanently — every retry would then fail on `email_exists`. So
   * this unwinds the lot and leaves them able to press the button again.
   */
  let createdUserId: string | null = null;
  const rollback = async (
    error: string,
    field?: ProvisionFailureField,
  ): Promise<ProvisionCompanyResult> => {
    const { error: companyCleanupError } = await sb.from('companies').delete().eq('id', companyId);
    let userCleanupError: string | null = null;
    if (createdUserId) {
      // Auth identity first, profile row second. Either one surviving alone
      // blocks the retry — the auth user on `email_exists`, the profile row on
      // its unique email, which the `on_auth_user_created` trigger would then
      // trip over. This order at least guarantees that a half-finished cleanup
      // cannot leave behind credentials that still sign in.
      const { error: authCleanupError } = await sb.auth.admin.deleteUser(createdUserId);
      // `public.users` has no foreign key to `auth.users`, so the profile the
      // trigger wrote is not removed with the identity.
      const { error: profileCleanupError } = await sb.from('users').delete().eq('id', createdUserId);
      userCleanupError = authCleanupError?.message ?? profileCleanupError?.message ?? null;
    }
    if (companyCleanupError || userCleanupError) {
      // The person gets the original message either way; this is for whoever
      // has to explain later why an email address will not sign up again.
      logger.error('Signup rollback left rows behind', {
        companyId,
        userId: createdUserId ?? undefined,
        module: 'onboarding',
        error: companyCleanupError?.message ?? userCleanupError ?? undefined,
      });
    }
    return { ok: false, error, field };
  };

  // 2. Subscription. `free_until` decides when the trial stops being free, so a
  // plan with a trial length gets one computed rather than left null, which the
  // billing path would read as "free forever".
  const freeUntil =
    input.freeUntil ??
    (plan.trialDays
      ? new Date(Date.now() + plan.trialDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      : null);
  const { error: subscriptionError } = await sb.from('subscriptions').insert({
    company_id: companyId,
    plan: input.plan,
    status: input.plan === 'free_trial' ? 'trialing' : 'active',
    free_until: freeUntil,
    message_limit: plan.messageLimit,
    bot_limit: plan.botLimit,
    agent_limit: plan.agentLimit,
    integration_limit: plan.integrationLimit,
  });
  if (subscriptionError) {
    return rollback(`Could not start your plan: ${subscriptionError.message}`);
  }

  // 3. AI budget controls, at their defaults. The row has to exist even when
  // every value is the default, because the spend controls screen reads it.
  const { error: budgetError } = await sb.from('company_ai_budgets').upsert({
    company_id: companyId,
    monthly_budget_usd: null,
    hard_stop_enabled: false,
    cache_enabled: true,
  });
  if (budgetError) {
    return rollback(`Could not set up AI spend controls: ${budgetError.message}`);
  }

  // 4. Credit wallet and its opening entry, so the balance on screen and the
  // ledger behind it agree from the first minute.
  const startingCredit = input.initialCreditGbp ?? plan.includedCreditGbp;
  const { error: walletError } = await sb.from('company_credit_accounts').upsert({
    company_id: companyId,
    currency: 'GBP',
    balance_amount: startingCredit,
    lifetime_credit_added: startingCredit,
    low_balance_threshold: 2,
  });
  if (walletError) {
    return rollback(`Could not set up your AI credit: ${walletError.message}`);
  }

  // 5. Auth user. The `on_auth_user_created` trigger (migration 0003) creates
  // the matching `public.users` profile.
  //
  // `email_confirm: true` because the product has no post-signup verification
  // screen: the account is created and the person is signed straight into it,
  // which needs a confirmed address. Introducing verification means adding that
  // screen and a resend path, not just flipping this flag.
  const { data: created, error: authError } = await sb.auth.admin.createUser({
    email,
    password: input.adminPassword,
    email_confirm: true,
    user_metadata: { full_name: input.adminName ?? null },
  });
  if (authError || !created?.user) {
    const described = describeAuthFailure(
      (authError as { code?: string } | null)?.code,
      authError?.message ?? 'unknown error',
    );
    return rollback(described.error, described.field);
  }
  createdUserId = created.user.id;

  // 6. Opening credit entry. After the auth user, because `created_by` points
  // at the person the credit was granted to.
  if (startingCredit > 0) {
    const { error: ledgerError } = await sb.from('company_credit_transactions').insert({
      company_id: companyId,
      type: 'included_credit',
      amount: startingCredit,
      currency: 'GBP',
      description: `${plan.label} included AI credit`,
      created_by: createdUserId,
      metadata_json: { plan: input.plan, signupSource: input.signupSource },
    });
    if (ledgerError) {
      return rollback(`Could not record your starting AI credit: ${ledgerError.message}`);
    }
  }

  // 7. Membership — the row that makes this person the owner of this company,
  // and the only thing standing between them and someone else's data.
  const { error: membershipError } = await sb
    .from('company_users')
    .insert({ company_id: companyId, user_id: createdUserId, role: ROLES.COMPANY_ADMIN });
  if (membershipError) {
    return rollback(`Could not link you to your new account: ${membershipError.message}`);
  }

  // 8. Audit
  await sb.from('audit_logs').insert({
    company_id: companyId,
    actor_user_id: createdUserId,
    action: input.auditAction,
    target_type: 'company',
    target_id: companyId,
    metadata_json: {
      plan: input.plan,
      signupSource: input.signupSource,
      adminEmail: email,
      freeUntil,
      startingCreditGbp: startingCredit,
      ...(input.auditMetadata ?? {}),
    },
  });

  logger.info('Company provisioned', {
    companyId,
    userId: createdUserId,
    module: 'onboarding',
    signupSource: input.signupSource,
  });

  return { ok: true, companyId, userId: createdUserId, slug };
}
