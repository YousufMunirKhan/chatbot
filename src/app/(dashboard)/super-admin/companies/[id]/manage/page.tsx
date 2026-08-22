import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile } from '@/components/ui/stat-tile';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getCompanyDetail } from '@/modules/super-admin/data';

export default async function SuperAdminCompanyManagePage({ params }: { params: { id: string } }) {
  // Defence in depth: the /super-admin layout already guards this subtree, but a
  // platform-operator surface should not rely on a single ancestor check.
  await requireRole([ROLES.SUPER_ADMIN]);
  const company = await getCompanyDetail(params.id);
  if (!company) notFound();
  const counts = company.counts ?? {
    documents: 0,
    quickActions: 0,
    leads: 0,
    appointments: 0,
    integrations: 0,
    qualityIssues: 0,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        backTo={{ href: `/super-admin/companies/${company.id}`, label: 'Back to company' }}
        title={`${company.name} management`}
        description="Platform view of the setup a company admin normally manages."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
        <StatTile label="Knowledge" value={counts.documents} />
        <StatTile label="Quick actions" value={counts.quickActions} />
        <StatTile label="Leads" value={counts.leads} />
        <StatTile label="Appointments" value={counts.appointments} />
        <StatTile label="Integrations" value={counts.integrations} />
        <StatTile label="Quality issues" value={counts.qualityIssues} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Assistants</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>AI</TableHead>
                <TableHead>Public bot ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {company.bots.map((bot) => (
                <TableRow key={bot.id}>
                  <TableCell className="font-medium">{bot.name}</TableCell>
                  <TableCell>{bot.botType.replace(/_/g, ' ')}</TableCell>
                  <TableCell>
                    <Badge variant={bot.aiEnabled ? 'success' : 'secondary'}>{bot.aiEnabled ? 'on' : 'off'}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{bot.publicBotId}</TableCell>
                </TableRow>
              ))}
              {company.bots.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-0">
                    <EmptyState title="No assistants yet." />
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Operator checklist</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Button asChild variant="outline">
            <Link href="/super-admin/quality">Review platform quality</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/super-admin/usage">Review usage and cost</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/super-admin/settings">Check platform AI/email settings</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/super-admin/audit-logs">Open audit logs</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
