import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { formatDate } from '@/lib/format';
import { listSecurityLogs } from '@/modules/super-admin/security-data';

export default async function SuperAdminSecurityPage() {
  await requireRole([ROLES.SUPER_ADMIN]);
  const logs = await listSecurityLogs();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Security Logs"
        description="Login, 2FA, and account security events."
      />
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow><TableHead>When</TableHead><TableHead>Event</TableHead><TableHead>User</TableHead><TableHead>Company</TableHead><TableHead>IP</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="text-muted-foreground">{formatDate(log.createdAt)}</TableCell>
                  <TableCell>{log.eventType}</TableCell>
                  <TableCell>{log.userEmail ?? 'system'}</TableCell>
                  <TableCell>{log.companyName ?? '-'}</TableCell>
                  <TableCell>{log.ip ?? '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
