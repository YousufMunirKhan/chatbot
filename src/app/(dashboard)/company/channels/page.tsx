import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { CopyButton } from '@/components/copy-button';
import { formatDate } from '@/lib/format';
import { listBots } from '@/modules/company/data';
import { channelFormDescriptors, listChannelIdentities } from '@/modules/company/channels-data';
import {
  toggleChannelIdentityAction,
  deleteChannelIdentityAction,
} from '@/modules/company/channels-actions';
import { ChannelForm } from '@/modules/company/components/channel-form';
import { ChannelRowTools } from '@/modules/company/components/channel-row-tools';
import { WhatsAppSetupGuide } from '@/modules/company/components/whatsapp-setup-guide';
import { ConfirmSubmit } from '@/components/confirm-submit';

export const dynamic = 'force-dynamic';

async function toggle(formData: FormData) {
  'use server';
  await toggleChannelIdentityAction(formData);
}
async function remove(formData: FormData) {
  'use server';
  await deleteChannelIdentityAction(formData);
}

const GMAIL_BANNERS: Record<string, { tone: 'success' | 'danger' | 'warning'; text: string }> = {
  connected: { tone: 'success', text: 'Gmail connected. New unread mail is answered on the next poll.' },
  failed: { tone: 'danger', text: 'Gmail could not be connected. Check the Google OAuth credentials and try again.' },
  taken: {
    tone: 'warning',
    text: 'That mailbox is already connected to another account. Contact support if it is yours.',
  },
};

export default async function ChannelsPage({
  searchParams,
}: {
  searchParams?: { gmail?: string };
}) {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const [identities, bots] = await Promise.all([listChannelIdentities(), listBots()]);
  const botOptions = bots.map((b) => ({ id: b.id, name: b.name }));
  const descriptors = channelFormDescriptors();
  const banner = searchParams?.gmail ? GMAIL_BANNERS[searchParams.gmail] : undefined;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Messaging apps"
        description="Your customers already message on WhatsApp, Messenger and Instagram. Connect the ones you use and the same assistant answers there too — every conversation still lands in one inbox."
      />

      {banner ? <Alert tone={banner.tone}>{banner.text}</Alert> : null}

      <Card id="connect-channel">
        <CardHeader>
          <CardTitle>Connect an app</CardTitle>
          <CardDescription>
            Two halves: you tell the app where to send its messages (the web address on the right), and you tell us
            how to send replies back (the details on the left). Telegram and Viber sort out the first half by
            themselves as soon as you save. If any of this is unfamiliar, it is a good job for whoever runs your
            social accounts.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          <ChannelForm bots={botOptions} channels={descriptors} />

          <div className="space-y-4">
            <div className="space-y-2 rounded-md border bg-muted/30 p-4 text-sm">
              <p className="font-medium">Email is the easy one</p>
              <p className="text-muted-foreground">
                Sign in with Gmail and that is the whole job — the assistant starts replying to unread customer
                mail in the same thread. Nothing to copy, nothing to forward.
              </p>
              <Button asChild size="sm">
                <a href="/api/channels/gmail/start">Connect Gmail</a>
              </Button>
            </div>

            <div className="space-y-2 rounded-md border bg-muted/30 p-4 text-sm">
              <p className="font-medium">Where each app should send its messages</p>
              <p className="text-muted-foreground">
                Paste the matching address into that app&apos;s developer settings. It is what lets a message
                someone sends you reach your assistant.
              </p>
              <ul className="space-y-1 text-muted-foreground">
                {descriptors.map((d) => (
                  <li key={d.key} className="truncate">
                    <span className="font-medium text-foreground">{d.label}:</span>{' '}
                    <code className="rounded bg-background px-1">{d.webhookUrl}</code>
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground">
                Facebook, Instagram and WhatsApp also ask for a &ldquo;verify token&rdquo; when you paste the
                address — that is the code shown next to each connected app in the list below, and you copy it
                across the same way. YouTube does not ask for one.
              </p>
            </div>
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
              body="Your assistant only answers on your website so far. Connect WhatsApp, Messenger, Telegram or email and it replies there too, in the same inbox."
              action={
                <Button asChild size="sm">
                  <a href="#connect-channel">Connect a channel</a>
                </Button>
              }
            />
          ) : (
            <ul className="divide-y">
              {identities.map((c) => (
                <li key={c.id} className="space-y-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{c.channelLabel}</Badge>
                        <Badge variant={c.isActive ? 'success' : 'outline'}>
                          {c.isActive ? 'Active' : 'Paused'}
                        </Badge>
                        {/* These two say the connection is only half done: messages
                             can arrive but nothing can be sent back. "No token" was
                             true and unhelpful — the badge now says the consequence. */}
                        {!c.hasSecret && c.channel !== 'email' ? (
                          <Badge variant="warning">Cannot reply yet</Badge>
                        ) : null}
                        {c.provider === 'gmail' ? <Badge variant="outline">Signed in with Gmail</Badge> : null}
                        {c.channel === 'line' && !c.hasAccessToken ? (
                          <Badge variant="warning">Cannot reply yet</Badge>
                        ) : null}
                        {/* Whether the password was actually tried against the
                             provider. A channel connected before this check
                             existed reads "not checked", not "working". */}
                        {c.health === 'ok' ? (
                          <Badge variant="success">Password checked</Badge>
                        ) : c.health === 'unverified' ? (
                          <Badge variant="outline">Cannot be checked</Badge>
                        ) : (
                          <Badge variant="outline">Not checked — send a test</Badge>
                        )}
                      </div>
                      {c.accountName ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Connected to {c.accountName}
                        </p>
                      ) : null}
                      {/* Falls back to the provider's own account id, which is a long
                           number nobody recognises. Naming it beats showing it bare. */}
                      <p className="mt-1 truncate font-medium">
                        {c.displayName ?? `${c.channelLabel} account ${c.externalId}`}
                      </p>
                      {c.displayName ? (
                        <p className="truncate text-xs text-muted-foreground">{c.externalId}</p>
                      ) : null}
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
                        <ConfirmSubmit
                          label="Delete"
                          question="Messages sent to this app stop reaching your inbox, and your assistant stops replying there."
                        />
                      </form>
                    </div>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 text-muted-foreground">Send messages to</span>
                      <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1">
                        {c.webhookUrl}
                      </code>
                      <CopyButton value={c.webhookUrl} />
                    </div>
                    {c.verifyToken ? (
                      <div className="flex items-center gap-2">
                        <span className="shrink-0 text-muted-foreground">Verify token</span>
                        <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1">
                          {c.verifyToken}
                        </code>
                        <CopyButton value={c.verifyToken} />
                      </div>
                    ) : null}
                    {c.verifyToken ? (
                      <p className="text-muted-foreground">
                        Paste both of these into this app&apos;s developer settings. The verify token is how it
                        proves it is really talking to your account — keep it to yourself.
                      </p>
                    ) : null}
                  </div>

                  <ChannelRowTools row={c} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
