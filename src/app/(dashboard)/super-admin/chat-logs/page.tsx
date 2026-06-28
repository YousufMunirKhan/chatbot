import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { listChatLogs } from '@/modules/super-admin/chat-logs-data';
import { listErrorLogCompanies } from '@/modules/super-admin/data';

const selectCls =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

type SearchParams = {
  companyId?: string;
  status?: string;
  auditStatus?: string;
  q?: string;
};

function badgeVariant(value: string | null): 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline' {
  if (value === 'perfect') return 'success';
  if (value === 'acceptable') return 'secondary';
  if (value === 'failed') return 'destructive';
  if (value === 'needs_review') return 'warning';
  return 'outline';
}

function label(value: string | null | undefined): string {
  if (!value) return 'Not audited';
  return value.replace(/_/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase());
}

export default async function SuperAdminChatLogsPage({ searchParams }: { searchParams?: SearchParams }) {
  const [rows, companies] = await Promise.all([
    listChatLogs({
      companyId: searchParams?.companyId || undefined,
      status: searchParams?.status || 'all',
      auditStatus: searchParams?.auditStatus || 'all',
      q: searchParams?.q || undefined,
      limit: 150,
    }),
    listErrorLogCompanies(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Chat Logs</h1>
        <p className="text-sm text-muted-foreground">
          Cross-company conversation review with automatic quality audit signals.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 lg:grid-cols-[minmax(180px,1fr)_160px_180px_minmax(180px,1fr)_auto]">
            <div className="space-y-1.5">
              <Label htmlFor="companyId">Company</Label>
              <select id="companyId" name="companyId" className={selectCls} defaultValue={searchParams?.companyId ?? ''}>
                <option value="">All companies</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="status">Chat status</Label>
              <select id="status" name="status" className={selectCls} defaultValue={searchParams?.status ?? 'all'}>
                <option value="all">All</option>
                <option value="ai_active">AI active</option>
                <option value="needs_human">Needs human</option>
                <option value="human_active">Human active</option>
                <option value="closed">Closed</option>
                <option value="expired">Expired</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="auditStatus">Audit</Label>
              <select id="auditStatus" name="auditStatus" className={selectCls} defaultValue={searchParams?.auditStatus ?? 'all'}>
                <option value="all">All</option>
                <option value="needs_review">Needs review</option>
                <option value="failed">Failed</option>
                <option value="acceptable">Acceptable</option>
                <option value="perfect">Perfect</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="q">Visitor id</Label>
              <Input id="q" name="q" defaultValue={searchParams?.q ?? ''} placeholder="Search visitor id" />
            </div>
            <div className="flex items-end gap-2">
              <Button type="submit">Apply</Button>
              <Button asChild variant="outline">
                <Link href="/super-admin/chat-logs">Reset</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Visitor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Audit</TableHead>
                <TableHead>Latest question</TableHead>
                <TableHead>Last activity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    No chat logs match these filters.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      <Link href={`/super-admin/chat-logs/${row.id}`} className="text-primary hover:underline">
                        {row.companyName}
                      </Link>
                      {row.botName ? <div className="text-xs text-muted-foreground">{row.botName}</div> : null}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{row.visitorId ?? '-'}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{label(row.status)}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={badgeVariant(row.qualityStatus)}>{label(row.qualityStatus)}</Badge>
                        {row.qualityScore == null ? null : <span className="text-xs text-muted-foreground">{row.qualityScore}%</span>}
                      </div>
                      {row.qualityLabel ? <div className="mt-1 text-xs text-muted-foreground">{label(row.qualityLabel)}</div> : null}
                    </TableCell>
                    <TableCell className="max-w-md truncate">{row.latestQuestion ?? '-'}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(row.lastMessageAt)}</TableCell>
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
