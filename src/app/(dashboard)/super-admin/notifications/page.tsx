import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { PlatformNotificationsForm } from '@/modules/super-admin/components/platform-notifications-form';
import { getPlatformNotificationSettings } from '@/modules/super-admin/notifications-data';

export default async function SuperAdminNotificationsPage() {
  await requireRole([ROLES.SUPER_ADMIN]);
  const settings = await getPlatformNotificationSettings();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Notification Delivery</h1>
        <p className="text-sm text-muted-foreground">
          Platform-level WhatsApp provider and defaults. Company recipients and event rules are
          managed inside each company notification center.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Platform sender settings</CardTitle>
          <CardDescription>
            Platform email sender is still managed from{' '}
            <Link href="/super-admin/settings" className="underline">
              Settings
            </Link>
            . WhatsApp credentials live here because all companies share the provider.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PlatformNotificationsForm settings={settings} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How delivery works</CardTitle>
          <CardDescription>
            A lead, booking, order, or handoff creates an in-app notification first. Then the
            delivery service checks that company&apos;s enabled channels and writes every send, skip, or
            failure to delivery logs.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Email can use your platform sender or a company&apos;s own SMTP details. WhatsApp recipients
          are set per company, but the Meta/Twilio provider is controlled here. Slack and generic
          webhooks are configured per company.
        </CardContent>
      </Card>
    </div>
  );
}
