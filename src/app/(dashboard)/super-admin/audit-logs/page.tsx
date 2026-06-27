import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { listAuditLogs } from '@/modules/super-admin/data';
import { formatDate } from '@/lib/format';

export default async function AuditLogsPage() {
  const logs = await listAuditLogs(150);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Audit Logs</h1>
        <p className="text-sm text-muted-foreground">
          Sensitive platform actions — onboarding, status changes, subscription edits, and (later)
          super-admin impersonation.
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    No audit entries yet.
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(l.createdAt)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{l.action}</TableCell>
                    <TableCell>{l.companyName ?? '—'}</TableCell>
                    <TableCell>{l.actorEmail ?? 'system'}</TableCell>
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
