'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getSessionUser, homePathFor } from '@/lib/auth';
import { verifyTwoFactorChallenge } from '@/lib/auth/two-factor';
import { rateLimitDistributed } from '@/lib/ratelimit';
import { logSecurityEvent } from '@/lib/security';

export type TwoFactorChallengeState = { error?: string };

const challengeSchema = z.object({
  code: z
    .string()
    .trim()
    .min(6, 'Enter the 6-digit code from your authenticator app.')
    .max(24, 'That does not look like a code.'),
});

/**
 * The second step at sign-in: a code from the authenticator app, or one of the
 * recovery codes, spent for good.
 *
 * Throttled hard. This is the one endpoint in the product where a six-digit
 * secret is checked against an attacker who already has the password, and
 * 1,000,000 possibilities is only a real defence if guessing is slow: ten tries
 * every five minutes leaves a brute force taking longer than the code's
 * lifetime by many orders of magnitude. The limit is keyed on the user rather
 * than the address so that changing networks does not reset it.
 */
export async function verifyTwoFactorChallengeAction(
  _prev: TwoFactorChallengeState,
  formData: FormData,
): Promise<TwoFactorChallengeState> {
  const user = await getSessionUser({ skipTwoFactorCheck: true });
  if (!user) redirect('/login');

  const parsed = challengeSchema.safeParse({ code: formData.get('code') });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Enter the 6-digit code.' };
  }

  // Read straight off the request the same way signUpAction does, so a refused
  // attempt in the security log carries where it came from.
  const requestHeaders = headers();
  const meta = {
    ip:
      requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      requestHeaders.get('x-real-ip'),
    userAgent: requestHeaders.get('user-agent'),
  };

  const limit = await rateLimitDistributed(`2fa:challenge:${user.userId}`, 10, 5 * 60 * 1000);
  if (!limit.ok) {
    await logSecurityEvent({
      userId: user.userId,
      companyId: user.companyId,
      eventType: 'two_factor.challenge_throttled',
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { error: 'Too many attempts. Wait five minutes and try again.' };
  }

  const result = await verifyTwoFactorChallenge(user.userId, parsed.data.code);
  if (!result.ok) {
    await logSecurityEvent({
      userId: user.userId,
      companyId: user.companyId,
      eventType: 'two_factor.challenge_failed',
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: { reason: result.reason },
    });
    if (result.reason === 'not_enrolled') {
      // Nothing to prove — their second factor was removed while this page was
      // open. Sending them onwards is correct; leaving them at a box that can
      // never be satisfied is not.
      redirect(homePathFor(user));
    }
    if (result.reason === 'unreadable_secret') {
      return {
        error:
          'We cannot read your authenticator setup. Use one of your recovery codes, then set the app up again.',
      };
    }
    if (result.reason === 'reused') {
      return { error: 'That code has already been used. Wait for your app to show the next one.' };
    }
    return { error: 'That code was not right. Check your phone and try again.' };
  }

  await logSecurityEvent({
    userId: user.userId,
    companyId: user.companyId,
    eventType: result.usedRecoveryCode ? 'two_factor.recovery_code_used' : 'login.2fa_success',
    ip: meta.ip,
    userAgent: meta.userAgent,
    metadata: { recoveryCodesRemaining: result.recoveryCodesRemaining },
  });

  // Somebody who just spent a recovery code is, by definition, without their
  // phone. Land them on the page that can issue a new set rather than on a
  // dashboard where they will forget until the next time they are locked out.
  if (result.usedRecoveryCode && user.companyId) redirect('/company/security');
  redirect(homePathFor(user));
}
