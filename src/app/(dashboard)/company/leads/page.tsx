import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { listLeadsPaged } from '@/modules/company/leads-data';
import { updateLeadStatusAction } from '@/modules/company/leads-actions';
import { LeadForm } from '@/modules/company/components/lead-form';
import { ListFilters, Pagination } from '@/modules/company/components/list-controls';

type BadgeVariant = 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline';

const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'converted', 'closed'] as const;

const selectCls =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function statusVariant(status: string): BadgeVariant {
  if (status === 'new') return 'default';
  if (status === 'contacted') return 'secondary';
  if (status === 'qualified') return 'warning';
  if (status === 'converted') return 'success';
  return 'outline';
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams?: { q?: string; status?: string; page?: string };
}) {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const search = searchParams?.q?.trim() || undefined;
  const status = searchParams?.status || 'all';
  const page = Number(searchParams?.page) || 1;
  const { rows: leads, total, pageCount, pageSize } = await listLeadsPaged({
    page,
    search,
    status,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Leads</h1>
          <p className="text-sm text-muted-foreground">
            Leads captured by your assistant or added manually.
          </p>
        </div>
        <Button asChild variant="outline">
          <a href="/api/company/leads/export">Export CSV</a>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add a lead</CardTitle>
        </CardHeader>
        <CardContent>
          <LeadForm />
        </CardContent>
      </Card>

      <div className="px-1">
        <ListFilters
          basePath="/company/leads"
          search={search}
          status={status}
          statuses={LEAD_STATUSES}
          placeholder="Search name, email, phone…"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {leads.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              {search || status !== 'all' ? 'No leads match your filters.' : 'No leads yet.'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Enquiry</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((lead) => (
                  <TableRow key={lead.id}>
                    <TableCell className="font-medium">{lead.name || '—'}</TableCell>
                    <TableCell>{lead.email ?? '—'}</TableCell>
                    <TableCell>{lead.phone ?? '—'}</TableCell>
                    <TableCell>{lead.enquiryType ?? '—'}</TableCell>
                    <TableCell>{formatDate(lead.createdAt)}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(lead.status)}>{lead.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <form action={updateLeadStatusAction} className="flex items-center gap-2">
                        <input type="hidden" name="leadId" value={lead.id} />
                        <select name="status" defaultValue={lead.status} className={selectCls}>
                          {LEAD_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                        <Button type="submit" variant="outline" size="sm">
                          Update
                        </Button>
                      </form>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {total > 0 && (
            <Pagination
              basePath="/company/leads"
              page={page}
              pageCount={pageCount}
              total={total}
              pageSize={pageSize}
              search={search}
              status={status}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
