import { redirect } from 'next/navigation';
import { AuthShell, AuthLink } from '../auth-shell';
import { getSessionUser, homePathFor } from '@/lib/auth';
import { getUserTwoFactorState } from '@/lib/auth/two-factor';
import { TwoFactorChallengeForm } from './two-factor-challenge-form';

export const metadata = { title: 'Two-step sign-in' };

/**
 * The second step at sign-in.
 *
 * Deliberately outside the dashboard's protected prefixes: the session check
 * that sends people here would otherwise send them here again, and they would
 * never see the box. `skipTwoFactorCheck` is the same reason.
 *
 * It used to render its own `max-w-sm` card on `bg-muted/30` — a fourth card
 * width and a second page ground, arrived at halfway through signing in, which
 * read as having been bounced to a different site at the worst possible moment.
 * Same shell as the form it just came from.
 */
export default async function TwoFactorChallengePage() {
  const user = await getSessionUser({ skipTwoFactorCheck: true });
  if (!user) redirect('/login');

  const state = await getUserTwoFactorState(user.userId);
  // Nothing to ask for. Somebody who lands here with 2FA off (a bookmark, a
  // back button after turning it off) should be moved along, not stuck.
  if (!state.enabled) redirect(homePathFor(user));
  // An emailed code is a different flow, and it has its own page from 0018.
  if (state.method !== 'totp') redirect('/login/2fa');

  return (
    <AuthShell
      title="One more step"
      description={`Open your authenticator app and enter the code it shows for ${user.email}.`}
      footer={<AuthLink href="/login">Back to sign in</AuthLink>}
    >
      <TwoFactorChallengeForm />
    </AuthShell>
  );
}
