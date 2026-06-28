import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { listAdminAccessLogs, listAuditLogs } from '@/modules/super-admin/data';
import { formatDate } from '@/lib/format';

export default async function AuditLogsPage() {
  const [logs, accessLogs] = await Promise.all([listAuditLogs(150), listAdminAccessLogs(150)]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Audit Logs</h1>
        <p className="text-sm text-muted-foreground">
          Sensitive platform actions, raw chat access, and super-admin impersonation.
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
                    <TableCell>{l.companyName ?? '-'}</TableCell>
                    <TableCell>{l.actorEmail ?? 'system'}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div>
        <h2 className="text-lg font-semibold">Super-admin access</h2>
        <p className="text-sm text-muted-foreground">
          Raw chat views and impersonation sessions are recorded here automatically.
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
                <TableHead>Target</TableHead>
                <TableHead>By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accessLogs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    No super-admin access entries yet.
                  </TableCell>
                </TableRow>
              ) : (
                accessLogs.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(l.createdAt)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{l.action}</TableCell>
                    <TableCell>{l.companyName ?? '-'}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {l.targetType ?? '-'} {l.targetId ? l.targetId.slice(0, 8) : ''}
                    </TableCell>
                    <TableCell>{l.adminEmail ?? 'system'}</TableCell>
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
