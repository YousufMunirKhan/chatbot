import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { InfoBanner } from '@/components/info-banner';
import { listCompanies } from '@/modules/super-admin/data';
import { formatNumber } from '@/lib/format';

export default async function UsagePage() {
  const companies = await listCompanies();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Usage</h1>
        <p className="text-sm text-muted-foreground">Messages consumed against plan limits.</p>
      </div>

      <InfoBanner>
        Per-message usage counters are populated once <strong>Module 20 (AI usage logging)</strong>{' '}
        is built. Limits below come from each company&apos;s subscription.
      </InfoBanner>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Messages used</TableHead>
                <TableHead>Limit</TableHead>
                <TableHead>Bots</TableHead>
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
                  <TableCell>0</TableCell>
                  <TableCell>{c.messageLimit == null ? 'Unlimited' : formatNumber(c.messageLimit)}</TableCell>
                  <TableCell>{formatNumber(c.botCount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
