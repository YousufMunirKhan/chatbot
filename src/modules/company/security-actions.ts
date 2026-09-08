'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getSessionUser, requireRole, type SessionUser } from '@/lib/auth';
import {
  beginTotpEnrolment,
  cancelTotpEnrolment,
  confirmTotpEnrolment,
  disableTotpForUser,
  getCompanyTwoFactorPolicy,
  getUserTwoFactorState,
  invalidateCompanyTwoFactorPolicy,
  replaceRecoveryCodes,
  verifyTwoFactorChallenge,
} from '@/lib/auth/two-factor';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { logSecurityEvent } from '@/lib/security';
import { rateLimitDistributed } from '@/lib/ratelimit';

/**
 * The usual `{ error }`, plus the one thing that only exists for an instant.
 *
 * `recoveryCodes` is returned to the browser and never written anywhere it can
 * be read back — this is the single moment those codes exist in plaintext, and
 * the form that receives them is what puts them in front of the user.
 */
export type SecurityActionState = { error?: string; ok?: boolean; recoveryCodes?: string[] };

/**
 * Audit trail for a security control. Same shape as `writeAudit` in
 * `src/modules/super-admin/actions.ts`; duplicated rather than imported because
 * that module is a server-action file for a different role and importing it
 * here would drag every super-admin action into this bundle.
 */
async function writeAudit(entry: {
  companyId?: string | null;
  actorId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}) {
  const sb = createSupabaseServiceClient();
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
 * The signed-in user, WITHOUT re-running the two-factor gate.
 *
 * `requireRole` cannot be used for the enrolment actions. A member whose
 * company has switched the policy on and whose grace period has run out is
 * being redirected to the enrolment page by that very check — so guarding the
 * action with it would bounce the request that completes their enrolment, and
 * they could never get back in. Role still matters for the policy actions
 * below, which use `requireRole` properly.
 */
async function requireEnrollingUser(): Promise<SessionUser> {
  const user = await getSessionUser({ skipTwoFactorCheck: true });
  if (!user) redirect('/login');
  return user;
}

function refreshTwoFactorPages(): void {
  revalidatePath('/company/security');
  revalidatePath('/two-factor/set-up');
}

// ---------------------------------------------------------------------------
// Enrolment
// ---------------------------------------------------------------------------

/** Mint a secret and show it. Nothing is switched on until a code proves it. */
export async function startTwoFactorEnrolmentAction(
  _prev: SecurityActionState,
  _formData: FormData,
): Promise<SecurityActionState> {
  const user = await requireEnrollingUser();
  const state = await getUserTwoFactorState(user.userId);
  if (state.enabled) return { error: 'Two-step sign-in is already on for your account.' };

  await beginTotpEnrolment(user.userId);
  await logSecurityEvent({
    userId: user.userId,
    companyId: user.companyId,
    eventType: 'two_factor.enrolment_started',
  });
  refreshTwoFactorPages();
  return { ok: true };
}

export async function cancelTwoFactorEnrolmentAction(
  _prev: SecurityActionState,
  _formData: FormData,
): Promise<SecurityActionState> {
  const user = await requireEnrollingUser();
  await cancelTotpEnrolment(user.userId);
  refreshTwoFactorPages();
  return { ok: true };
}

const codeSchema = z.object({
  code: z
    .string()
    .trim()
    .min(6, 'Enter the 6-digit code from your authenticator app.')
    .max(20, 'That does not look like a code.'),
});

/**
 * Finish enrolment on a code that actually works, and hand back the recovery
 * codes.
 *
 * Throttled per user because this endpoint compares a six-digit number: without
 * a limit, a session that is already signed in could sit and guess.
 */
export async function confirmTwoFactorEnrolmentAction(
  _prev: SecurityActionState,
  formData: FormData,
): Promise<SecurityActionState> {
  const user = await requireEnrollingUser();
  const parsed = codeSchema.safeParse({ code: formData.get('code') });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Enter the 6-digit code.' };
  }

  const limit = await rateLimitDistributed(`2fa:enrol:${user.userId}`, 10, 5 * 60 * 1000);
  if (!limit.ok) {
    return { error: 'Too many attempts. Wait five minutes and try again.' };
  }

  const result = await confirmTotpEnrolment(user.userId, parsed.data.code);
  if (!result.ok) {
    await logSecurityEvent({
      userId: user.userId,
      companyId: user.companyId,
      eventType: 'two_factor.enrolment_failed',
      metadata: { reason: result.reason },
    });
    if (result.reason === 'no_pending') {
      return { error: 'That setup has expired. Start again to get a fresh QR code.' };
    }
    if (result.reason === 'reused') {
      return { error: 'That code has already been used. Wait for your app to show the next one.' };
    }
    return {
      error:
        'That code was not right. Check your phone shows the correct account, and that its clock is set automatically.',
    };
  }

  await logSecurityEvent({
    userId: user.userId,
    companyId: user.companyId,
    eventType: 'two_factor.enabled',
    metadata: { method: 'totp' },
  });
  await writeAudit({
    companyId: user.companyId,
    actorId: user.userId,
    action: 'two_factor.user_enabled',
    targetType: 'user',
    targetId: user.userId,
    metadata: { method: 'totp' },
  });
  refreshTwoFactorPages();
  return { ok: true, recoveryCodes: result.recoveryCodes };
}

/**
 * Turn "a code, or a recovery code" into a yes or no.
 *
 * Both of the actions below are guarded by proof of the second factor rather
 * than by the session alone — a session cookie is exactly what an attacker has
 * when they have stolen one, and either action would otherwise hand them the
 * account permanently.
 *
 * A recovery code is accepted alongside a live authenticator code, and that is
 * not a weakening: it is the only way somebody who has lost their phone can get
 * back to a working setup. Without it they sign in with a recovery code, reach
 * this page, and find that removing the app they no longer have requires a code
 * from the app they no longer have. `verifyTwoFactorChallenge` handles both
 * shapes, spends the recovery code, and enforces the TOTP replay guard.
 */
async function proveSecondFactor(
  user: SessionUser,
  formData: FormData,
  limitKey: string,
): Promise<{ ok: true } | { ok: false; state: SecurityActionState }> {
  const parsed = codeSchema.safeParse({ code: formData.get('code') });
  if (!parsed.success) {
    return {
      ok: false,
      state: { error: 'Enter a current code from your authenticator app, or one of your recovery codes.' },
    };
  }

  const limit = await rateLimitDistributed(limitKey, 5, 15 * 60 * 1000);
  if (!limit.ok) {
    return { ok: false, state: { error: 'Too many attempts. Wait fifteen minutes and try again.' } };
  }

  const result = await verifyTwoFactorChallenge(user.userId, parsed.data.code);
  if (result.ok) return { ok: true };

  await logSecurityEvent({
    userId: user.userId,
    companyId: user.companyId,
    eventType: 'two_factor.reauth_failed',
    metadata: { reason: result.reason },
  });
  if (result.reason === 'not_enrolled') {
    return { ok: false, state: { error: 'Set up an authenticator app first.' } };
  }
  if (result.reason === 'unreadable_secret') {
    return {
      ok: false,
      state: { error: 'We cannot read your authenticator setup. Use one of your recovery codes instead.' },
    };
  }
  if (result.reason === 'reused') {
    return {
      ok: false,
      state: { error: 'That code has already been used. Wait for your app to show the next one.' },
    };
  }
  return { ok: false, state: { error: 'That code was not right.' } };
}

/**
 * Fresh recovery codes, retiring every earlier one.
 *
 * The old set stops working the moment this succeeds, which is why the new one
 * is returned and shown immediately rather than mailed or stored.
 */
export async function regenerateRecoveryCodesAction(
  _prev: SecurityActionState,
  formData: FormData,
): Promise<SecurityActionState> {
  const user = await requireEnrollingUser();
  const proof = await proveSecondFactor(user, formData, `2fa:recovery:${user.userId}`);
  if (!proof.ok) return proof.state;

  const recoveryCodes = await replaceRecoveryCodes(user.userId);
  await logSecurityEvent({
    userId: user.userId,
    companyId: user.companyId,
    eventType: 'two_factor.recovery_codes_regenerated',
  });
  refreshTwoFactorPages();
  return { ok: true, recoveryCodes };
}

/**
 * Take your own second factor off — with proof, and only when your company is
 * not requiring one.
 */
export async function disableMyTwoFactorAction(
  _prev: SecurityActionState,
  formData: FormData,
): Promise<SecurityActionState> {
  const user = await requireEnrollingUser();

  // Checked before the code is spent: refusing afterwards would burn a recovery
  // code to be told no.
  if (user.companyId) {
    const policy = await getCompanyTwoFactorPolicy(user.companyId, { fresh: true });
    if (policy.required) {
      return {
        error:
          'Your company requires two-step sign-in, so this cannot be turned off here. An owner or admin can turn the requirement off on this page first.',
      };
    }
  }

  const state = await getUserTwoFactorState(user.userId);
  if (!state.enabled) return { error: 'Two-step sign-in is already off.' };

  const proof = await proveSecondFactor(user, formData, `2fa:disable:${user.userId}`);
  if (!proof.ok) return proof.state;

  await disableTotpForUser(user.userId);
  await logSecurityEvent({
    userId: user.userId,
    companyId: user.companyId,
    eventType: 'two_factor.disabled',
  });
  await writeAudit({
    companyId: user.companyId,
    actorId: user.userId,
    action: 'two_factor.user_disabled',
    targetType: 'user',
    targetId: user.userId,
    metadata: { method: 'totp' },
  });
  refreshTwoFactorPages();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The company policy
// ---------------------------------------------------------------------------

const policySchema = z.object({
  required: z.preprocess((value) => value === 'on' || value === 'true', z.boolean()),
  gracePeriodDays: z.preprocess(
    (value) => (value === '' || value == null ? 14 : value),
    z.coerce
      .number()
      .int('Enter a whole number of days.')
      .min(0, 'A grace period cannot be negative.')
      .max(90, 'Ninety days is the longest grace period allowed.'),
  ),
});

/**
 * Turn the company requirement on or off. Company admins only, always audited.
 *
 * Two things this deliberately does NOT do. It does not enable two-step sign-in
 * on anybody's account — it cannot, because only the person holding the phone
 * can complete an enrolment — and it does not end anybody's session. What it
 * does is start a clock: members who have not enrolled are nudged until
 * `grace_period_days` have passed, and only then are they sent to the setup
 * page before they can carry on. Anything more abrupt ejects a team mid-shift.
 *
 * Turning it OFF is the event this audit row exists for. A security control
 * being removed is exactly what somebody reading the log later needs to find,
 * along with who did it and when.
 */
export async function setCompanyTwoFactorPolicyAction(
  _prev: SecurityActionState,
  formData: FormData,
): Promise<SecurityActionState> {
  const user = await requireRole([ROLES.COMPANY_ADMIN]);
  if (!user.companyId) return { error: 'No company is selected for this account.' };

  const parsed = policySchema.safeParse({
    required: formData.get('required'),
    gracePeriodDays: formData.get('gracePeriodDays'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }
  const { required, gracePeriodDays } = parsed.data;

  const previous = await getCompanyTwoFactorPolicy(user.companyId, { fresh: true });

  // The clock only restarts when the requirement goes from off to on. Editing
  // the grace period while it is already running must not silently give
  // everybody a fresh fortnight — or, worse, expire them early.
  const requiredSince = required
    ? previous.required && previous.requiredSince
      ? previous.requiredSince
      : new Date().toISOString()
    : null;

  const sb = createSupabaseServiceClient();
  const { error } = await sb.from('company_two_factor_policies').upsert(
    {
      company_id: user.companyId,
      required,
      grace_period_days: gracePeriodDays,
      required_since: requiredSince,
      updated_by: user.userId,
    },
    { onConflict: 'company_id' },
  );
  if (error) return { error: 'That did not save. Try again in a moment.' };

  invalidateCompanyTwoFactorPolicy(user.companyId);

  await writeAudit({
    companyId: user.companyId,
    actorId: user.userId,
    action: required ? 'two_factor.policy_enabled' : 'two_factor.policy_disabled',
    targetType: 'company',
    targetId: user.companyId,
    metadata: {
      required,
      previouslyRequired: previous.required,
      gracePeriodDays,
      requiredSince,
    },
  });
  await logSecurityEvent({
    userId: user.userId,
    companyId: user.companyId,
    eventType: required ? 'two_factor.policy_enabled' : 'two_factor.policy_disabled',
    metadata: { gracePeriodDays },
  });

  refreshTwoFactorPages();
  return { ok: true };
}
