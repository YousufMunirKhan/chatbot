import { redirect } from 'next/navigation';
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
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-8">
      <div className="w-full max-w-sm space-y-6 rounded-lg border bg-background p-6 shadow-sm">
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-semibold">One more step</h1>
          <p className="text-sm text-muted-foreground">
            Open your authenticator app and enter the code it shows for {user.email}.
          </p>
        </div>
        <TwoFactorChallengeForm />
      </div>
    </main>
  );
}
