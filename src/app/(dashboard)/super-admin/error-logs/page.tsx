import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { resolveErrorLogAction } from '@/modules/super-admin/error-log-actions';
import {
  listErrorLogCompanies,
  listErrorLogs,
  type ErrorLogSeverity,
  type ErrorLogStatus,
} from '@/modules/super-admin/data';

const severities = ['all', 'info', 'warning', 'error', 'critical'] as const;
const statuses = ['open', 'all', 'resolved'] as const;

function badgeVariant(severity: ErrorLogSeverity): 'secondary' | 'warning' | 'destructive' | 'outline' {
  if (severity === 'critical' || severity === 'error') return 'destructive';
  if (severity === 'warning') return 'warning';
  if (severity === 'info') return 'secondary';
  return 'outline';
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function cleanStatus(value: string | undefined): ErrorLogStatus {
  return statuses.includes(value as ErrorLogStatus) ? (value as ErrorLogStatus) : 'open';
}

function cleanSeverity(value: string | undefined): ErrorLogSeverity | 'all' {
  return severities.includes(value as ErrorLogSeverity | 'all') ? (value as ErrorLogSeverity | 'all') : 'all';
}

export default async function ErrorLogsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  // Defence in depth: the /super-admin layout already guards this subtree, but a
  // platform-operator surface should not rely on a single ancestor check.
  await requireRole([ROLES.SUPER_ADMIN]);
  const filters = {
    companyId: first(searchParams.companyId),
    severity: cleanSeverity(first(searchParams.severity)),
    source: first(searchParams.source),
    status: cleanStatus(first(searchParams.status)),
    q: first(searchParams.q),
    limit: 150,
  };
  const [logs, companies] = await Promise.all([listErrorLogs(filters), listErrorLogCompanies()]);
  const exportParams = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value && key !== 'limit') exportParams.set(key, String(value));
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Error Logs"
        description="Super Admin-only operational errors from APIs, chat, widgets, integrations, and client reports."
        actions={
          <Button asChild variant="outline">
            <a href={`/api/super-admin/error-logs/export?${exportParams.toString()}`}>Export CSV</a>
          </Button>
        }
      />

      <Card>
        <CardContent className="pt-6">
          <form className="grid gap-3 md:grid-cols-5">
            <Select name="companyId" defaultValue={filters.companyId ?? ''} aria-label="Company">
              <option value="">All companies</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </Select>
            <Select name="severity" defaultValue={filters.severity} aria-label="Severity">
              {severities.map((severity) => (
                <option key={severity} value={severity}>
                  {severity === 'all' ? 'All severities' : severity}
                </option>
              ))}
            </Select>
            <Select name="status" defaultValue={filters.status} aria-label="Status">
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {status === 'open' ? 'Open only' : status}
                </option>
              ))}
            </Select>
            <Input
              name="source"
              defaultValue={filters.source ?? ''}
              placeholder="Source"
              aria-label="Source"
            />
            <div className="flex gap-2">
              <Input
                name="q"
                defaultValue={filters.q ?? ''}
                placeholder="Search message"
                aria-label="Search message"
                className="min-w-0 flex-1"
              />
              <Button type="submit">Filter</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Message</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-0">
                    <EmptyState title="No error logs match these filters." />
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log) => (
                  <TableRow key={log.id} className="align-top">
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(log.createdAt)}</TableCell>
                    <TableCell><Badge variant={badgeVariant(log.severity)}>{log.severity}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{log.source}</TableCell>
                    <TableCell>{log.companyName ?? '-'}</TableCell>
                    <TableCell className="max-w-xl">
                      <div className="font-medium">{log.message}</div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {log.route ? <span>{log.route}</span> : null}
                        {log.statusCode ? <span>HTTP {log.statusCode}</span> : null}
                        {log.botName ? <span>Bot: {log.botName}</span> : null}
                        {log.conversationId ? <span>Conversation: {log.conversationId.slice(0, 8)}</span> : null}
                      </div>
                      {log.stack ? (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs text-muted-foreground">Stack / metadata</summary>
                          <pre className="mt-2 max-h-56 overflow-auto rounded-md bg-muted p-3 text-xs">
                            {log.stack}
                            {'\n\n'}
                            {JSON.stringify(log.metadata, null, 2)}
                          </pre>
                        </details>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {log.resolvedAt ? (
                        <Badge variant="secondary">Resolved</Badge>
                      ) : (
                        <Badge variant="outline">Open</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-end">
                      {!log.resolvedAt ? (
                        <form action={resolveErrorLogAction}>
                          <input type="hidden" name="id" value={log.id} />
                          <Button type="submit" size="sm" variant="outline">Resolve</Button>
                        </form>
                      ) : null}
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
