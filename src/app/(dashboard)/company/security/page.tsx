import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { requireRole } from '@/lib/auth';
import { ROLES, humanizeToken } from '@/lib/constants';
import { formatDate } from '@/lib/format';
import { SecurityTwoFactorCard } from '@/modules/company/components/security-two-factor-card';
import { SecurityTwoFactorPolicyForm } from '@/modules/company/components/security-two-factor-policy-form';
import {
  getMySecuritySettings,
  getTeamTwoFactorSummary,
  getTwoFactorPanel,
} from '@/modules/company/security-data';

/**
 * Audit ids, in words.
 *
 * This page exists to reassure, and `auth login_failed` in a list does the
 * opposite — it looks like a fault in the product. Anything unmapped falls
 * through to `humanizeToken`, so a new event type is still readable.
 */
const ACTIVITY_LABELS: Record<string, string> = {
  'auth.login': 'You signed in',
  'auth.login_failed': 'A sign-in was refused — wrong password',
  'auth.logout': 'You signed out',
  'auth.password_changed': 'Your password was changed',
  'auth.password_reset': 'A password reset was requested',
  'login.password_success': 'You signed in with your password',
  'login.2fa_success': 'You passed the second step',
  'login.2fa_failed': 'A wrong second-step code was entered',
  'two_factor.enrolment_started': 'You started setting up an authenticator app',
  'two_factor.enrolment_failed': 'A setup code did not match',
  'two_factor.enabled': 'You turned two-step sign-in on',
  'two_factor.disabled': 'You turned two-step sign-in off',
  'two_factor.reauth_failed': 'A wrong code was entered while changing your two-step settings',
  'two_factor.challenge_failed': 'A wrong second-step code was entered',
  'two_factor.challenge_throttled': 'Too many second-step attempts were refused',
  'two_factor.recovery_code_used': 'A recovery code was used to sign in',
  'two_factor.recovery_codes_regenerated': 'You generated new recovery codes',
  'two_factor.recovery_regenerate_failed': 'A wrong code was entered while generating recovery codes',
  'two_factor.policy_enabled': 'Two-step sign-in was made a requirement for your company',
  'two_factor.policy_disabled': 'The two-step sign-in requirement was removed for your company',
};

export default async function CompanySecurityPage() {
  const user = await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const [settings, panel] = await Promise.all([getMySecuritySettings(), getTwoFactorPanel()]);

  // Only read the team roll-up for somebody who can actually act on it.
  const canManagePolicy = Boolean(panel?.canManagePolicy && user.companyId);
  const team = canManagePolicy
    ? await getTeamTwoFactorSummary(user.companyId as string)
    : { total: 0, enrolled: 0 };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Sign-in & security"
        description="Add a second step when you sign in, and see what has happened on your account lately."
      />

      {panel ? <SecurityTwoFactorCard panel={panel} /> : null}

      {panel && canManagePolicy ? (
        <SecurityTwoFactorPolicyForm
          policy={panel.policy}
          team={team}
          companyName={panel.companyName}
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Recent activity on your account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {settings.recentEvents.length ? (
            settings.recentEvents.map((event) => (
              <div
                key={event.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
              >
                <span>{ACTIVITY_LABELS[event.eventType] ?? humanizeToken(event.eventType)}</span>
                <span className="text-muted-foreground">{formatDate(event.createdAt)}</span>
              </div>
            ))
          ) : (
            <EmptyState
              title="Nothing to show yet"
              body="Sign-ins, password changes, and any refused attempt on your account will be listed here."
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
