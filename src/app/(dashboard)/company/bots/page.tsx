import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { listBots } from '@/modules/company/data';
import { formatDate } from '@/lib/format';

function assistantTypeLabel(audience: string) {
  return audience === 'internal' ? 'Internal Help Desk bot' : 'Customer-facing website bot';
}

function assistantTypeHint(audience: string) {
  return audience === 'internal'
    ? 'Staff support, software guides, connectors, actions'
    : 'Website widget, customer chat, leads, bookings, handoff';
}

export default async function BotsPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const bots = await listBots();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Assistants</h1>
          <p className="text-sm text-muted-foreground">{bots.length} configured</p>
        </div>
        <Button asChild>
          <Link href="/company/bots/new">New assistant</Link>
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Assistant</TableHead>
                <TableHead>Capabilities</TableHead>
                <TableHead>AI</TableHead>
                <TableHead>Created</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bots.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    No assistants yet.{' '}
                    <Link href="/company/bots/new" className="text-primary hover:underline">
                      Create one
                    </Link>
                    .
                  </TableCell>
                </TableRow>
              ) : (
                bots.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>
                      <div className="font-medium">{b.name}</div>
                      <div className="text-xs text-muted-foreground">{assistantTypeHint(b.assistantAudience)}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={b.assistantAudience === 'internal' ? 'warning' : 'secondary'}>
                        {assistantTypeLabel(b.assistantAudience)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{b.capabilityFlags.length}</Badge>
                    </TableCell>
                    <TableCell>{b.aiEnabled ? 'On' : 'Off'}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(b.createdAt)}</TableCell>
                    <TableCell className="text-end">
                      <div className="flex justify-end gap-3">
                        {b.assistantAudience === 'internal' ? (
                          <Link href="/company/help-desk" className="text-sm text-primary hover:underline">
                            Help Desk
                          </Link>
                        ) : (
                          <Link href="/company/widget" className="text-sm text-primary hover:underline">
                            Widget
                          </Link>
                        )}
                        <Link href={`/company/bots/${b.id}/settings`} className="text-sm text-primary hover:underline">
                          Settings
                        </Link>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
