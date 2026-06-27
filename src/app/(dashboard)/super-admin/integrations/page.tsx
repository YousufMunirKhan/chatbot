import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { InfoBanner } from '@/components/info-banner';
import { listCompanies } from '@/modules/super-admin/data';

export default async function IntegrationsPage() {
  const companies = await listCompanies();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Integrations</h1>
        <p className="text-sm text-muted-foreground">
          Connected sources and sync status across all companies.
        </p>
      </div>

      <InfoBanner>
        Integration accounts and sync jobs are introduced in <strong>Module 14</strong>. Once a
        company connects Shopify / WooCommerce / CSV / Custom API, their connectors and last-sync
        status appear here.
      </InfoBanner>

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
