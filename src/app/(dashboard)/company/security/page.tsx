import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { requireRole } from '@/lib/auth';
import { ROLES, humanizeToken } from '@/lib/constants';
import { formatDate } from '@/lib/format';
import { setTwoFactorEnabledAction } from '@/modules/company/security-actions';
import { getMySecuritySettings } from '@/modules/company/security-data';

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
  'two_factor.enabled': 'You turned on the emailed code',
  'two_factor.disabled': 'You turned off the emailed code',
  'two_factor.challenge_failed': 'A wrong emailed code was entered',
};

export default async function CompanySecurityPage() {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const settings = await getMySecuritySettings();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Sign-in & security"
        description="Add a second step when you sign in, and see what has happened on your account lately."
      />

      <Card>
        <CardHeader>
          <CardTitle>Ask for a code when I sign in</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Badge variant={settings.twoFactorEnabled ? 'success' : 'secondary'}>
            {settings.twoFactorEnabled ? 'On' : 'Off'}
          </Badge>
          <p className="text-sm text-muted-foreground">
            With this on, we email you a short code every time you sign in, and you type it in after your password.
            It means someone who steals your password still cannot get into your account.
          </p>
          <form action={setTwoFactorEnabledAction}>
            <input type="hidden" name="enabled" value={settings.twoFactorEnabled ? 'off' : 'on'} />
            <Button type="submit" variant={settings.twoFactorEnabled ? 'outline' : 'default'}>
              {settings.twoFactorEnabled ? 'Stop asking for a code' : 'Start asking for a code'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity on your account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {settings.recentEvents.length ? (
            settings.recentEvents.map((event) => (
              <div key={event.id} className="flex items-center justify-between rounded-md border p-3 text-sm">
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
