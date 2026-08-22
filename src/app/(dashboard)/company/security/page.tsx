import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { formatDate } from '@/lib/format';
import { setTwoFactorEnabledAction } from '@/modules/company/security-actions';
import { getMySecuritySettings } from '@/modules/company/security-data';

export default async function CompanySecurityPage() {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const settings = await getMySecuritySettings();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Security"
        description="Optional 2FA and your recent security activity."
      />

      <Card>
        <CardHeader>
          <CardTitle>Two-factor authentication</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Badge variant={settings.twoFactorEnabled ? 'success' : 'secondary'}>
            {settings.twoFactorEnabled ? 'Enabled' : 'Disabled'}
          </Badge>
          <p className="text-sm text-muted-foreground">
            When enabled, login requires a one-time code sent to your email after password sign-in.
          </p>
          <form action={setTwoFactorEnabledAction}>
            <input type="hidden" name="enabled" value={settings.twoFactorEnabled ? 'off' : 'on'} />
            <Button type="submit" variant={settings.twoFactorEnabled ? 'outline' : 'default'}>
              {settings.twoFactorEnabled ? 'Disable 2FA' : 'Enable 2FA'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {settings.recentEvents.length ? (
            settings.recentEvents.map((event) => (
              <div key={event.id} className="flex items-center justify-between rounded-md border p-3 text-sm">
                <span>{event.eventType.replace(/\./g, ' ')}</span>
                <span className="text-muted-foreground">{formatDate(event.createdAt)}</span>
              </div>
            ))
          ) : (
            <EmptyState title="No security activity yet." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
