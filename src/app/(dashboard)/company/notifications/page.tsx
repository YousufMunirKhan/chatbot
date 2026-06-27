import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { formatDate } from '@/lib/format';
import { listNotifications, unreadCount } from '@/modules/company/notifications-data';
import { markAllReadAction, markReadAction } from '@/modules/company/notifications-actions';
import {
  getCompanyNotificationSettings,
  listNotificationDeliveryLogs,
} from '@/modules/company/notification-settings';
import { NotificationSettingsForm } from '@/modules/company/components/notification-settings-form';

const tabs = [
  { key: 'inbox', label: 'Inbox' },
  { key: 'settings', label: 'Delivery settings' },
  { key: 'logs', label: 'Delivery logs' },
];

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
  const [notifications, unread, settings, logs] = await Promise.all([
    listNotifications(),
    unreadCount(),
    canManageDelivery ? getCompanyNotificationSettings() : Promise.resolve(null),
    canManageDelivery ? listNotificationDeliveryLogs() : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            {unread > 0 ? `${unread} unread` : 'All caught up.'}
          </p>
        </div>
        {activeTab === 'inbox' && unread > 0 ? (
          <form action={markAllReadAction}>
            <Button type="submit" variant="outline">
              Mark all read
            </Button>
          </form>
        ) : null}
      </div>

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
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="border-b bg-muted/30">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Time</th>
                      <th className="px-3 py-2 text-left font-medium">Event</th>
                      <th className="px-3 py-2 text-left font-medium">Channel</th>
                      <th className="px-3 py-2 text-left font-medium">Recipient</th>
                      <th className="px-3 py-2 text-left font-medium">Status</th>
                      <th className="px-3 py-2 text-left font-medium">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr key={log.id} className="border-b">
                        <td className="px-3 py-2 text-muted-foreground">{formatDate(log.createdAt)}</td>
                        <td className="px-3 py-2">{log.eventType.replace(/_/g, ' ')}</td>
                        <td className="px-3 py-2">{log.channel}</td>
                        <td className="max-w-[220px] truncate px-3 py-2">{log.recipient ?? '-'}</td>
                        <td className="px-3 py-2">
                          <Badge
                            variant={log.status === 'sent' ? 'default' : log.status === 'failed' ? 'destructive' : 'secondary'}
                          >
                            {log.status}
                          </Badge>
                        </td>
                        <td className="max-w-[260px] truncate px-3 py-2 text-muted-foreground">
                          {log.errorMessage ?? '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No delivery attempts yet.</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {activeTab === 'inbox' && notifications.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">No notifications yet.</p>
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
                    <Badge variant="secondary">{n.type.replace(/_/g, ' ')}</Badge>
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
