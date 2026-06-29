import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate } from '@/lib/format';
import { listBroadcasts } from '@/modules/company/broadcasts-data';
import { deleteBroadcastAction } from '@/modules/company/broadcasts-actions';
import { BroadcastForm } from '@/modules/company/components/broadcast-form';

async function cancel(formData: FormData) {
  'use server';
  await deleteBroadcastAction(formData);
}

function statusVariant(status: string): 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline' {
  if (status === 'sent') return 'success';
  if (status === 'failed') return 'destructive';
  if (status === 'sending') return 'warning';
  return 'secondary';
}

export default async function BroadcastsPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const broadcasts = await listBroadcasts();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Broadcasts</h1>
        <p className="text-sm text-muted-foreground">
          Send a WhatsApp or email campaign to your lead list. Requires a connected{' '}
          <Link href="/company/channels" className="text-primary hover:underline">
            channel
          </Link>
          .
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New broadcast</CardTitle>
          <CardDescription>Dispatched by the scheduled job to all leads with a matching contact.</CardDescription>
        </CardHeader>
        <CardContent>
          <BroadcastForm />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {broadcasts.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No broadcasts yet.</p>
          ) : (
            <ul className="divide-y">
              {broadcasts.map((b) => (
                <li key={b.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="capitalize">{b.channel}</Badge>
                      <Badge variant={statusVariant(b.status)}>{b.status}</Badge>
                      {b.status === 'sent' ? (
                        <span className="text-xs text-muted-foreground">{b.sentCount} sent</span>
                      ) : null}
                    </div>
                    {b.subject ? <p className="mt-1 font-medium">{b.subject}</p> : null}
                    <p className="mt-0.5 text-sm text-muted-foreground">{b.message}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {b.scheduleAt ? `Scheduled ${formatDate(b.scheduleAt)}` : 'Sends on next run'}
                    </p>
                  </div>
                  {b.status === 'scheduled' ? (
                    <form action={cancel}>
                      <input type="hidden" name="id" value={b.id} />
                      <Button type="submit" variant="ghost" size="sm">
                        Cancel
                      </Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
