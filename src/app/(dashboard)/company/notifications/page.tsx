import { requireRole } from '@/lib/auth';
import {
  ROLES,
  CHANNEL_LABELS,
  DELIVERY_STATUS_LABELS,
  PROVIDER_LABELS,
  humanizeToken,
  labelFor,
} from '@/lib/constants';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { listNotifications, unreadCount } from '@/modules/company/notifications-data';
import { markAllReadAction, markReadAction } from '@/modules/company/notifications-actions';
import {
  getCompanyNotificationSettings,
  listNotificationDeliveryLogs,
} from '@/modules/company/notification-settings';
import { NotificationSettingsForm } from '@/modules/company/components/notification-settings-form';
import { PushAlertsCard } from '@/modules/company/components/push-alerts-card';
import { getPushOverview } from '@/modules/company/push-data';
import { RefreshOnFocus } from '@/components/refresh-on-focus';

const tabs = [
  { key: 'inbox', label: 'Your alerts' },
  { key: 'settings', label: 'Who gets told' },
  { key: 'logs', label: 'What was sent' },
];

/**
 * A delivery row names the app the alert went out through — `whatsapp_cloud`,
 * `webhook`, `slack`. Two different vocabularies land in that column (our
 * conversation channels and our outbound providers), so both maps are tried
 * before falling back to the prettifier.
 */
function deliveryChannelLabel(value: string): string {
  return CHANNEL_LABELS[value] ?? PROVIDER_LABELS[value] ?? humanizeToken(value);
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams?: { tab?: string };
}) {
  const user = await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const canManageDelivery = user.role === ROLES.COMPANY_ADMIN;
  const visibleTabs = canManageDelivery ? tabs : tabs.filter((tab) => tab.key === 'inbox');
  const requestedTab = searchParams?.tab;
  const activeTab = visibleTabs.some((tab) => tab.key === requestedTab) ? requestedTab : 'inbox';
  const [notifications, unread, settings, logs, push] = await Promise.all([
    listNotifications(),
    unreadCount(),
    canManageDelivery ? getCompanyNotificationSettings() : Promise.resolve(null),
    canManageDelivery ? listNotificationDeliveryLogs() : Promise.resolve([]),
    getPushOverview(),
  ]);

  // Phone alerts are a per-DEVICE, per-person setting, so agents need it too —
  // and they never see the "Who gets told" tab. Admins get it there, alongside
  // the delivery grid whose new "Phone alert" column it switches on.
  const showPushCard = activeTab === 'settings' || (activeTab === 'inbox' && !canManageDelivery);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <RefreshOnFocus />
      <PageHeader
        title="Alerts"
        description={
          unread > 0
            ? `${unread} you have not read yet. We tell you here whenever a customer leaves their details, books something, or asks for a person.`
            : 'You are up to date. We tell you here whenever a customer leaves their details, books something, or asks for a person.'
        }
        actions={
          activeTab === 'inbox' && unread > 0 ? (
            <form action={markAllReadAction}>
              <Button type="submit" variant="outline">
                Mark all read
              </Button>
            </form>
          ) : null
        }
      />

      <div className="flex flex-wrap gap-2 border-b">
        {visibleTabs.map((tab) => (
          <Link
            key={tab.key}
            href={`/company/notifications?tab=${tab.key}`}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${
              activeTab === tab.key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {showPushCard ? (
        <PushAlertsCard
          devices={push.myDevices}
          companyDeviceCount={push.companyDeviceCount}
          configured={push.configured}
        />
      ) : null}

      {activeTab === 'settings' && settings ? (
        <Card>
          <CardHeader>
            <CardTitle>Delivery settings</CardTitle>
            <CardDescription>
              Decide who receives leads, bookings, orders, and handoff alerts by email,
              WhatsApp, Slack, or webhook.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <NotificationSettingsForm settings={settings} />
          </CardContent>
        </Card>
      ) : null}

      {activeTab === 'logs' ? (
        <Card>
          <CardHeader>
            <CardTitle>Delivery logs</CardTitle>
            <CardDescription>Recent sent, skipped, and failed notification attempts.</CardDescription>
          </CardHeader>
          <CardContent>
            {logs.length ? (
              <Table className="min-w-[720px]">
                <TableHeader className="bg-muted/30">
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Sent by</TableHead>
                    <TableHead>Sent to</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>What went wrong</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-muted-foreground">{formatDate(log.createdAt)}</TableCell>
                      <TableCell>{humanizeToken(log.eventType)}</TableCell>
                      <TableCell>{deliveryChannelLabel(log.channel)}</TableCell>
                      <TableCell className="max-w-[220px] truncate">{log.recipient ?? '-'}</TableCell>
                      <TableCell>
                        <Badge
                          variant={log.status === 'sent' ? 'default' : log.status === 'failed' ? 'destructive' : 'secondary'}
                        >
                          {labelFor(DELIVERY_STATUS_LABELS, log.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[260px] truncate text-muted-foreground">
                        {log.errorMessage ?? '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              // Module 1 — nothing has been sent yet; point at the rules that decide sending.
              <EmptyState
                title="Nothing has been sent yet"
                body="Every email, WhatsApp and Slack alert you send out is listed here, along with the reason whenever one does not arrive."
                action={
                  <Button asChild size="sm" variant="outline">
                    <Link href="/company/notifications?tab=settings">Check delivery settings</Link>
                  </Button>
                }
              />
            )}
          </CardContent>
        </Card>
      ) : null}

      {activeTab === 'inbox' && notifications.length === 0 ? (
        // Module 2 — admins can act on this; agents only get the explanation.
        <Card>
          <CardContent className="p-0">
            <EmptyState
              title="No notifications yet"
              body="You will get one here whenever a lead, booking, order, or handoff request comes in. Nothing has happened yet."
              action={
                canManageDelivery ? (
                  <Button asChild size="sm" variant="outline">
                    <Link href="/company/notifications?tab=settings">Choose who gets alerted</Link>
                  </Button>
                ) : null
              }
            />
          </CardContent>
        </Card>
      ) : null}

      {activeTab === 'inbox' && notifications.length > 0 ? (
        <div className="space-y-3">
          {notifications.map((n) => (
            <Card key={n.id} className={n.read ? undefined : 'border-primary/40 bg-primary/5'}>
              <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{n.title || '—'}</span>
                    <Badge variant="secondary">{humanizeToken(n.type)}</Badge>
                    {n.read ? null : <Badge variant="default">Unread</Badge>}
                  </div>
                  {n.body ? <p className="text-sm text-muted-foreground">{n.body}</p> : null}
                  <p className="text-xs text-muted-foreground">{formatDate(n.createdAt)}</p>
                </div>
                {n.read ? null : (
                  <form action={markReadAction}>
                    <input type="hidden" name="notificationId" value={n.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      Mark read
                    </Button>
                  </form>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}
