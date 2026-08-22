import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { formatDate } from '@/lib/format';
import { listBots } from '@/modules/company/data';
import { listChannelIdentities } from '@/modules/company/channels-data';
import {
  toggleChannelIdentityAction,
  deleteChannelIdentityAction,
} from '@/modules/company/channels-actions';
import { ChannelForm } from '@/modules/company/components/channel-form';
import { WhatsAppSetupGuide } from '@/modules/company/components/whatsapp-setup-guide';
import { ConfirmSubmit } from '@/components/confirm-submit';

async function toggle(formData: FormData) {
  'use server';
  await toggleChannelIdentityAction(formData);
}
async function remove(formData: FormData) {
  'use server';
  await deleteChannelIdentityAction(formData);
}

const WEBHOOK_PATHS: Record<string, string> = {
  whatsapp: '/api/webhooks/whatsapp',
  instagram: '/api/webhooks/instagram',
  email: '/api/webhooks/email',
};

export default async function ChannelsPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const [identities, bots] = await Promise.all([listChannelIdentities(), listBots()]);
  const botOptions = bots.map((b) => ({ id: b.id, name: b.name }));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Channels"
        description="Connect WhatsApp, Instagram, and email so customers can reach your AI on the channels they already use."
      />

      <Card id="connect-channel">
        <CardHeader>
          <CardTitle>Connect a channel</CardTitle>
          <CardDescription>Point the provider&apos;s webhook at this app, then add the credentials here.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          <ChannelForm bots={botOptions} />
          <div className="space-y-3 rounded-md border bg-muted/30 p-4 text-sm">
            <p className="font-medium">Webhook setup</p>
            <ul className="space-y-2 text-muted-foreground">
              <li>
                <span className="font-medium text-foreground">WhatsApp / Instagram:</span> set the callback URL to{' '}
                <code className="rounded bg-background px-1">{WEBHOOK_PATHS.whatsapp}</code> /{' '}
                <code className="rounded bg-background px-1">{WEBHOOK_PATHS.instagram}</code> and the verify token to your{' '}
                <code className="rounded bg-background px-1">WHATSAPP_VERIFY_TOKEN</code> env value.
              </li>
              <li>
                <span className="font-medium text-foreground">Email:</span> forward inbound mail to{' '}
                <code className="rounded bg-background px-1">{WEBHOOK_PATHS.email}</code> via your provider&apos;s
                inbound-parse.
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <WhatsAppSetupGuide />

      <Card>
        <CardContent className="p-0">
          {identities.length === 0 ? (
            // Module 1 — the connect form is on this page, so link straight to it.
            <EmptyState
              title="No channels connected yet"
              body="Your assistant only answers on your website so far. Connect WhatsApp, Instagram, or email and it replies there too, in the same inbox."
              action={
                <Button asChild size="sm">
                  <a href="#connect-channel">Connect a channel</a>
                </Button>
              }
            />
          ) : (
            <ul className="divide-y">
              {identities.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="capitalize">{c.channel}</Badge>
                      <Badge variant={c.isActive ? 'success' : 'outline'}>{c.isActive ? 'Active' : 'Paused'}</Badge>
                      {!c.hasSecret && c.channel !== 'email' ? (
                        <Badge variant="warning">No token</Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 truncate font-medium">{c.externalId}</p>
                    <p className="text-xs text-muted-foreground">Connected {formatDate(c.createdAt)}</p>
                  </div>
                  <div className="flex gap-2">
                    <form action={toggle}>
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="active" value={(!c.isActive).toString()} />
                      <Button type="submit" size="sm" variant="outline">
                        {c.isActive ? 'Pause' : 'Activate'}
                      </Button>
                    </form>
                    <form action={remove}>
                      <input type="hidden" name="id" value={c.id} />
                      <ConfirmSubmit label="Delete" question="Messages from this channel stop arriving." />
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
