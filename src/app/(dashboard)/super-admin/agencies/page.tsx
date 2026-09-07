import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { formatDate } from '@/lib/format';
import {
  listAgencies,
  listAgencyCompanies,
  listUnattachedCompanies,
} from '@/modules/super-admin/agencies-data';
import {
  attachCompanyAction,
  detachCompanyAction,
  toggleAgencyAction,
} from '@/modules/super-admin/agencies-actions';
import { AgencyForm } from '@/modules/super-admin/components/agency-form';
import { ConfirmSubmit } from '@/components/confirm-submit';

export const dynamic = 'force-dynamic';

async function toggle(formData: FormData) {
  'use server';
  await toggleAgencyAction(formData);
}
async function attach(formData: FormData) {
  'use server';
  await attachCompanyAction(formData);
}
async function detach(formData: FormData) {
  'use server';
  await detachCompanyAction(formData);
}

export default async function AgenciesPage() {
  await requireRole([ROLES.SUPER_ADMIN]);
  const [agencies, attachments, available] = await Promise.all([
    listAgencies(),
    listAgencyCompanies(),
    listUnattachedCompanies(),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Agencies"
        description="White-label resellers. An agency re-brands the dashboard and the login page for every company attached to it."
      />

      <Card id="new-agency">
        <CardHeader>
          <CardTitle>New agency</CardTitle>
          <CardDescription>
            The owner must already have a platform account — they get the agency screen inside their
            own company workspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AgencyForm />
        </CardContent>
      </Card>

      {agencies.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              title="No agencies yet"
              body="Create one to let a reseller run sub-accounts under their own name and logo."
              action={
                <Button asChild size="sm">
                  <a href="#new-agency">Create an agency</a>
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : null}

      {agencies.map((agency) => {
        const subAccounts = attachments.filter((a) => a.agencyId === agency.id);
        return (
          <Card key={agency.id}>
            <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {agency.name}
                  <Badge variant={agency.isActive ? 'success' : 'outline'}>
                    {agency.isActive ? 'Active' : 'Paused'}
                  </Badge>
                </CardTitle>
                <CardDescription>
                  {agency.slug} · {agency.ownerEmail ?? 'no owner set'} ·{' '}
                  {agency.customDomain ?? 'no custom domain'} · created {formatDate(agency.createdAt)}
                </CardDescription>
              </div>
              <form action={toggle}>
                <input type="hidden" name="agencyId" value={agency.id} />
                <input type="hidden" name="active" value={(!agency.isActive).toString()} />
                <Button type="submit" size="sm" variant="outline">
                  {agency.isActive ? 'Deactivate' : 'Activate'}
                </Button>
              </form>
            </CardHeader>

            <CardContent className="space-y-6">
              <AgencyForm
                agency={{
                  id: agency.id,
                  name: agency.name,
                  ownerEmail: agency.ownerEmail,
                  customDomain: agency.customDomain,
                  branding: agency.branding,
                }}
              />

              <div className="space-y-3 rounded-md border p-4">
                <p className="text-sm font-medium">
                  Sub-accounts <span className="text-muted-foreground">({agency.companyCount})</span>
                </p>

                {subAccounts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No companies attached yet.</p>
                ) : (
                  <ul className="divide-y">
                    {subAccounts.map((sub) => (
                      <li
                        key={sub.companyId}
                        className="flex flex-wrap items-center justify-between gap-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{sub.companyName}</p>
                          <p className="text-xs text-muted-foreground">
                            Attached {formatDate(sub.attachedAt)}
                          </p>
                        </div>
                        <form action={detach}>
                          <input type="hidden" name="agencyId" value={agency.id} />
                          <input type="hidden" name="companyId" value={sub.companyId} />
                          <ConfirmSubmit
                            label="Detach"
                            confirmLabel="Yes, detach"
                            question="This company goes back to the platform's own branding."
                          />
                        </form>
                      </li>
                    ))}
                  </ul>
                )}

                {available.length > 0 ? (
                  <form action={attach} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="agencyId" value={agency.id} />
                    <div className="min-w-[14rem] flex-1">
                      <label
                        htmlFor={`${agency.id}-attach`}
                        className="mb-1 block text-xs text-muted-foreground"
                      >
                        Attach a company
                      </label>
                      <Select id={`${agency.id}-attach`} name="companyId" size="sm">
                        {available.map((company) => (
                          <option key={company.id} value={company.id}>
                            {company.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <Button type="submit" size="sm" variant="outline">
                      Attach
                    </Button>
                  </form>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Every company is already attached to an agency.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
