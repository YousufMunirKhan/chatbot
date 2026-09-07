import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { PLAN_LABELS, ROLES, SUBSCRIPTION_STATUS_LABELS, labelFor } from '@/lib/constants';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { UpgradeNotice } from '@/components/ui/upgrade-notice';
import { companyHasFeature } from '@/lib/entitlements';
import { formatDate, formatNumber } from '@/lib/format';
import { getOwnedAgency, listSubAccounts } from '@/modules/company/agency-data';
import { AgencyBrandingForm } from '@/modules/company/components/agency-branding-form';
import { SubAccountForm } from '@/modules/company/components/sub-account-form';

export const dynamic = 'force-dynamic';

function gbp(value: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value);
}

/**
 * Agency owner's console.
 *
 * VISIBILITY: the page exists only for the user who owns an agency. Anyone else
 * — including another admin of the same company — gets a 404 rather than an
 * empty screen, because "there is no such page for you" is the honest answer
 * and it leaks nothing about who the owner is.
 *
 * ENTITLEMENT: the 404 comes FIRST and the package check second, on purpose. A
 * company with no agency has nothing here whatever it pays, and telling it what
 * a package it cannot buy would unlock is noise; only an actual agency owner is
 * shown the upgrade state. No priced package includes `agency` — it is a
 * commercial arrangement — so an owner whose subscription does not carry the
 * override lands on a screen that says to talk to us, which is the truth.
 */
export default async function CompanyAgencyPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const agency = await getOwnedAgency();
  if (!agency) notFound();
  if (!(await companyHasFeature('agency'))) {
    return <UpgradeNotice feature="agency" title={agency.name} />;
  }

  const subAccounts = await listSubAccounts(agency.id);
  const totals = subAccounts.reduce(
    (acc, s) => ({
      messages: acc.messages + s.messagesThisMonth,
      conversations: acc.conversations + s.conversations,
      credit: acc.credit + s.creditBalance,
    }),
    { messages: 0, conversations: 0, credit: 0 },
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={agency.name}
        description="The accounts you look after, and the logo and colours each of them sees."
        actions={
          <Badge variant={agency.isActive ? 'success' : 'outline'}>
            {agency.isActive ? 'Active' : 'Paused'}
          </Badge>
        }
      />

      {!agency.isActive ? (
        <Alert tone="warning">
          This agency is deactivated, so its companies show the platform&apos;s own branding and you
          cannot create new sub-accounts. Contact platform support.
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryTile label="Sub-accounts" value={formatNumber(subAccounts.length)} />
        <SummaryTile label="AI operations this month" value={formatNumber(totals.messages)} />
        <SummaryTile label="Credit across accounts" value={gbp(totals.credit)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Branding</CardTitle>
          <CardDescription>
            Applied to the dashboard and the login page of every company attached to your agency.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AgencyBrandingForm branding={agency.branding} />
        </CardContent>
      </Card>

      <Card id="new-sub-account">
        <CardHeader>
          <CardTitle>New sub-account</CardTitle>
          <CardDescription>
            Creates a company on the plan you pick and attaches it to your agency. Invite its team
            from that company&apos;s own Team screen afterwards.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SubAccountForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sub-accounts</CardTitle>
          <CardDescription>
            Usage this calendar month, and the credit each one has left.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {subAccounts.length === 0 ? (
            <EmptyState
              title="No sub-accounts yet"
              body="Create one above, or ask platform support to attach an existing company to your agency."
            />
          ) : (
            <ul className="divide-y">
              {subAccounts.map((sub) => (
                <li
                  key={sub.companyId}
                  className="flex flex-wrap items-start justify-between gap-3 p-4"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{sub.name}</span>
                      {/* Billing state and plan are what an agency owner scans
                          this list for, so both say the sold name rather than
                          the stored one — `past_due` in particular is a bill to
                          chase, not a status word. */}
                      <Badge variant={sub.status === 'active' ? 'success' : 'outline'}>
                        {labelFor(SUBSCRIPTION_STATUS_LABELS, sub.status, 'No subscription')}
                      </Badge>
                      {sub.plan ? (
                        <Badge variant="outline">{labelFor(PLAN_LABELS, sub.plan)}</Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Created {formatDate(sub.createdAt)}
                    </p>
                  </div>
                  <dl className="flex flex-wrap gap-4 text-sm">
                    <Stat label="AI ops" value={formatNumber(sub.messagesThisMonth)} />
                    <Stat label="Chats" value={formatNumber(sub.conversations)} />
                    <Stat label="Credit" value={gbp(sub.creditBalance)} />
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-end">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}
