import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { getSessionUser, homePathFor } from '@/lib/auth';
import { SecurityTwoFactorCard } from '@/modules/company/components/security-two-factor-card';
import { getTwoFactorPanel } from '@/modules/company/security-data';

export const metadata = { title: 'Set up two-step sign-in' };

/**
 * Enrolment, outside the dashboard.
 *
 * This page has to live here rather than under `/company` for one structural
 * reason: the session check redirects a member whose grace period has expired
 * to this route, and every `/company` page runs that same check on render. Put
 * the forced-enrolment page inside the guarded area and the redirect points at
 * itself.
 *
 * It is not only for people who are being made to. Somebody can walk here
 * voluntarily and the copy reads the same; what changes is whether the notice
 * at the top says their company is now asking.
 */
export default async function TwoFactorSetUpPage() {
  const user = await getSessionUser({ skipTwoFactorCheck: true });
  if (!user) redirect('/login');

  const panel = await getTwoFactorPanel();
  if (!panel) redirect('/login');

  const graceHasPassed = Boolean(
    panel.policy.required && panel.policy.graceEndsAt && Date.parse(panel.policy.graceEndsAt) <= Date.now(),
  );

  return (
    <main className="flex min-h-screen items-start justify-center bg-muted/30 p-6 sm:p-8">
      <div className="w-full max-w-xl space-y-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Set up two-step sign-in</h1>
          <p className="text-sm text-muted-foreground">
            Signed in as {panel.accountEmail}.
          </p>
        </div>

        {panel.status !== 'on' && graceHasPassed ? (
          <Alert tone="warning" title={`${panel.companyName} now requires two-step sign-in`}>
            The time your company allowed for setting this up has passed, so it is needed before you
            can carry on. It takes about a minute and you only do it once.
          </Alert>
        ) : null}

        {panel.status !== 'on' && panel.policy.required && !graceHasPassed ? (
          <Alert tone="info" title={`${panel.companyName} is asking everyone to set this up`}>
            You can keep working as normal for now. Doing it today means it is never a surprise
            later.
          </Alert>
        ) : null}

        <SecurityTwoFactorCard panel={panel} />

        <div className="text-sm">
          {panel.status === 'on' ? (
            <Link href={homePathFor(user)} className="font-medium underline underline-offset-4">
              Continue to your dashboard
            </Link>
          ) : graceHasPassed ? (
            <p className="text-muted-foreground">
              Stuck? Ask an owner or admin at {panel.companyName} — they can lift the requirement on
              the Sign-in &amp; security page.
            </p>
          ) : (
            <Link href={homePathFor(user)} className="font-medium underline underline-offset-4">
              Skip for now
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
