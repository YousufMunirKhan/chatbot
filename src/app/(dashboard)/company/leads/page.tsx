import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { listLeadsPaged } from '@/modules/company/leads-data';
import { updateLeadStatusAction } from '@/modules/company/leads-actions';
import { LeadForm } from '@/modules/company/components/lead-form';
import { ListFilters, Pagination } from '@/modules/company/components/list-controls';
import { RefreshOnFocus } from '@/components/refresh-on-focus';

type BadgeVariant = 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline';

const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'converted', 'closed'] as const;

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
  const filtered = Boolean(search) || status !== 'all';

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <RefreshOnFocus />
      <PageHeader
        title="Leads"
        description="Leads captured by your assistant or added manually."
        actions={
          <Button asChild variant="outline">
            <a href="/api/company/leads/export">Export CSV</a>
          </Button>
        }
      />

      <Card id="add-lead">
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
          {leads.length === 0 && filtered ? (
            // Module 1 — a filter is hiding everything, so offer the way back.
            <EmptyState
              title="No leads match your filters"
              body={
                <>
                  Nothing matches {search ? <>&ldquo;{search}&rdquo;</> : 'this search'}
                  {status !== 'all' ? ` with status ${status}` : ''}. Try a different term or start over.
                </>
              }
              action={
                <Button asChild size="sm" variant="outline">
                  <Link href="/company/leads">Clear filters</Link>
                </Button>
              }
            />
          ) : leads.length === 0 ? (
            // Module 2 — genuinely no leads yet.
            <EmptyState
              title="No leads yet"
              body="When a visitor leaves their name and contact details in chat, they show up here. You can also add someone you spoke to by phone."
              action={
                <Button asChild size="sm">
                  <a href="#add-lead">Add a lead</a>
                </Button>
              }
            />
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
                        <Select name="status" size="sm" defaultValue={lead.status} aria-label="Lead status">
                          {LEAD_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </Select>
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
