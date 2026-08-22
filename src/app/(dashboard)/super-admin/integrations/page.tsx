import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import Link from 'next/link';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { listCompanies } from '@/modules/super-admin/data';

export default async function IntegrationsPage() {
  // Defence in depth: the /super-admin layout already guards this subtree, but a
  // platform-operator surface should not rely on a single ancestor check.
  await requireRole([ROLES.SUPER_ADMIN]);
  const companies = await listCompanies();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integrations"
        description="Connected sources and sync status across all companies."
      />

      {/*
        "This module ships later" is a statement of fact, not a warning — the
        operator has nothing to do about it. `info`, not the old amber banner.
      */}
      <Alert tone="info">
        Integration accounts and sync jobs are introduced in <strong>Module 14</strong>. Once a
        company connects Shopify / WooCommerce / CSV / Custom API, their connectors and last-sync
        status appear here.
      </Alert>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Integrations</TableHead>
                <TableHead>Last sync</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link href={`/super-admin/companies/${c.id}`} className="font-medium text-primary hover:underline">
                      {c.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">None connected</TableCell>
                  <TableCell className="text-muted-foreground">—</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
