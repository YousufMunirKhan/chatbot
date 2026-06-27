import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { formatDate } from '@/lib/format';
import { listNotifications, unreadCount } from '@/modules/company/notifications-data';
import { markAllReadAction, markReadAction } from '@/modules/company/notifications-actions';

export default async function NotificationsPage() {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const [notifications, unread] = await Promise.all([listNotifications(), unreadCount()]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            {unread > 0 ? `${unread} unread` : 'All caught up.'}
          </p>
        </div>
        {unread > 0 ? (
          <form action={markAllReadAction}>
            <Button type="submit" variant="outline">
              Mark all read
            </Button>
          </form>
        ) : null}
      </div>

      {notifications.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">No notifications yet.</p>
          </CardContent>
        </Card>
      ) : (
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
      )}
    </div>
  );
}
