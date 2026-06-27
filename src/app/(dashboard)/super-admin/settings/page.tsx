import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import {
  AiSettingsForm,
  EmailSettingsForm,
  RealtimeSettingsForm,
  StripeSettingsForm,
} from '@/modules/super-admin/components/platform-settings-forms';
import { getPlatformSettingsView } from '@/modules/super-admin/settings-data';

export default async function SuperAdminSettingsPage() {
  await requireRole([ROLES.SUPER_ADMIN]);
  const settings = await getPlatformSettingsView();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Platform Settings</h1>
        <p className="text-sm text-muted-foreground">
          Runtime AI keys, model defaults, and email delivery settings for the whole project.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>AI Providers</CardTitle>
          <CardDescription>
            Stored in the database so Super Admin can rotate OpenAI and Claude keys without
            redeploying.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AiSettingsForm settings={settings.ai} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Realtime Chat Transport</CardTitle>
          <CardDescription>
            Current no-polling chat stream plus future custom WebSocket option.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RealtimeSettingsForm settings={settings.realtime} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stripe Billing</CardTitle>
          <CardDescription>
            Checkout keys, webhook secret, and billing enablement for company subscriptions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StripeSettingsForm settings={settings.stripe} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Email Delivery</CardTitle>
          <CardDescription>
            Used for invites, notifications, test emails, and future password setup flows.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EmailSettingsForm settings={settings.email} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Setting Events</CardTitle>
          <CardDescription>Key rotations, provider changes, and test results.</CardDescription>
        </CardHeader>
        <CardContent>
          {settings.events.length ? (
            <div className="space-y-2">
              {settings.events.map((event) => (
                <div
                  key={event.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
                >
                  <div>
                    <p className="font-medium">{event.eventType.replace(/_/g, ' ')}</p>
                    <p className="text-xs text-muted-foreground">
                      {event.settingKey ?? 'platform'} · {event.actorEmail ?? 'system'}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(event.createdAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No setting events yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
