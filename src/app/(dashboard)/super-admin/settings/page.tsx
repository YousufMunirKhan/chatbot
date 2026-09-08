import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import {
  AiSettingsForm,
  EmailSettingsForm,
  RealtimeSettingsForm,
  StripeSettingsForm,
} from '@/modules/super-admin/components/platform-settings-forms';
import { getPlatformSettingsView } from '@/modules/super-admin/settings-data';
import { ModelPolicyCard } from './model-policy-card';

export default async function SuperAdminSettingsPage() {
  await requireRole([ROLES.SUPER_ADMIN]);
  const settings = await getPlatformSettingsView();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform Settings"
        description="Runtime AI keys, model defaults, and email delivery settings for the whole project."
      />

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

      {/* Directly under the model pickers, because it is the consequence of
          them: which package may reach the advanced model, and what a month of
          replies on it costs against what that package is sold for. */}
      <ModelPolicyCard
        chatProvider={settings.ai.chatProvider}
        chatModel={settings.ai.chatModel}
        advancedChatModel={settings.ai.advancedChatModel}
      />

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
            <EmptyState title="No setting events yet." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
