import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { listBots } from '@/modules/company/data';
import { formatDate } from '@/lib/format';

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
                <TableHead>Type</TableHead>
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
                    <TableCell className="font-medium">{b.name}</TableCell>
                    <TableCell>{b.botType.replace(/_/g, ' ')}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{b.capabilityFlags.length}</Badge>
                    </TableCell>
                    <TableCell>{b.aiEnabled ? 'On' : 'Off'}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(b.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <Link href={`/company/bots/${b.id}/settings`} className="text-sm text-primary hover:underline">
                        Settings
                      </Link>
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
