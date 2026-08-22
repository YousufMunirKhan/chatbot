import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { InfoBanner } from '@/components/info-banner';
import { PageHeader } from '@/components/ui/page-header';
import { requireRole } from '@/lib/auth';
import { ROLES, DEFAULT_CHAT_RETENTION_DAYS } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from '@/modules/company/data';
import { RetentionForm } from '@/modules/company/components/retention-form';
import { DataRequestForm } from '@/modules/company/components/data-request-form';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/format';
import { listDataRequests } from '@/modules/company/gdpr-data';
import { processDataRequestAction } from '@/modules/company/gdpr-actions';
import { ConfirmSubmit } from '@/components/confirm-submit';

const SECTIONS: Array<{ href: string; label: string; hint: string }> = [
  { href: '/company/agents', label: 'Team', hint: 'Agents, invites, and availability.' },
  { href: '/company/billing', label: 'Billing', hint: 'Plan, usage limits, and subscription.' },
  { href: '/company/integrations', label: 'Integrations', hint: 'Calendars, commerce, and data sync.' },
  { href: '/company/quick-actions', label: 'Quick actions', hint: 'Chat buttons and handoff shortcuts.' },
  { href: '/company/ai-controls', label: 'AI budget', hint: 'Monthly spend cap, hard stop, and caching.' },
  { href: '/company/quality', label: 'Quality', hint: 'Feedback and answer evaluation.' },
  { href: '/company/usage', label: 'Usage', hint: 'Messages, cost, and limits.' },
  { href: '/company/security', label: 'Security', hint: 'Access, privacy, and protections.' },
  { href: '/company/channels', label: 'Channels', hint: 'WhatsApp, Instagram, email, and SMS.' },
  { href: '/company/broadcasts', label: 'Broadcasts', hint: 'Send a message to a group of customers.' },
  { href: '/company/campaigns', label: 'Campaigns', hint: 'Proactive messages triggered by visitor behaviour.' },
  { href: '/company/managed-connectors', label: 'Managed connectors', hint: 'Shopify, Square, and Foodics, connected for you.' },
  { href: '/company/catalog', label: 'Catalog', hint: 'Products and menu items the assistant can quote.' },
];

async function getRetentionDays(): Promise<number> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('company_settings')
    .select('value_json')
    .eq('company_id', companyId)
    .eq('key', 'chat_retention_days')
    .maybeSingle();
  if (!data) return DEFAULT_CHAT_RETENTION_DAYS;
  const raw = (data as Record<string, unknown>).value_json;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CHAT_RETENTION_DAYS;
}

async function processRequest(formData: FormData) {
  'use server';
  await processDataRequestAction(formData);
}

export default async function CompanySettingsPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const [retentionDays, dataRequests] = await Promise.all([getRetentionDays(), listDataRequests()]);
  const openRequests = dataRequests.filter((r) => r.status === 'open' || r.status === 'processing');

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={<>Team &amp; Settings</>}
        description="People, billing, privacy, integrations, and advanced controls."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {SECTIONS.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="rounded-lg border bg-card p-4 hover:bg-muted/50"
          >
            <p className="text-sm font-medium">{section.label}</p>
            <p className="mt-1 text-xs text-muted-foreground">{section.hint}</p>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Data retention</CardTitle>
          <CardDescription>Chats older than this are automatically deleted.</CardDescription>
        </CardHeader>
        <CardContent>
          <RetentionForm current={retentionDays} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Data requests</CardTitle>
          <CardDescription>Create export/delete requests for privacy operations.</CardDescription>
        </CardHeader>
        <CardContent>
          <DataRequestForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pending data requests</CardTitle>
          <CardDescription>
            Execute a deletion to permanently erase a person&apos;s leads, appointments, and linked chats — or reject it.
            Every erasure is logged.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {openRequests.length === 0 ? (
            <EmptyState title="No pending requests." />
          ) : (
            <ul className="divide-y">
              {openRequests.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant={r.requestType === 'delete' ? 'destructive' : 'secondary'}>{r.requestType}</Badge>
                      <span className="truncate font-medium">{r.requesterEmail}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Requested {formatDate(r.createdAt)}</p>
                  </div>
                  <div className="flex gap-2">
                    <form action={processRequest}>
                      <input type="hidden" name="requestId" value={r.id} />
                      <input type="hidden" name="decision" value="execute" />
                      {r.requestType === 'delete' ? (
                        <ConfirmSubmit
                          label="Erase data"
                          confirmLabel="Erase permanently"
                          pendingLabel="Erasing…"
                          question="Permanently deletes this person's conversations, leads and appointments."
                          typeToConfirm="ERASE"
                          idleVariant="destructive"
                        />
                      ) : (
                        <Button type="submit" size="sm">Mark done</Button>
                      )}
                    </form>
                    <form action={processRequest}>
                      <input type="hidden" name="requestId" value={r.id} />
                      <input type="hidden" name="decision" value="reject" />
                      <Button type="submit" size="sm" variant="ghost">
                        Reject
                      </Button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your data</CardTitle>
          <CardDescription>Download a JSON bundle of your company&apos;s records.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <a href="/api/company/export">Export my data</a>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Security</CardTitle>
          <CardDescription>Protections enforced on your account.</CardDescription>
        </CardHeader>
        <CardContent>
          <InfoBanner>
            <ul className="list-disc space-y-1 ps-5">
              <li>Integration tokens are encrypted at rest.</li>
              <li>Company data isolation enforced via row-level security (RLS).</li>
              <li>Rate limiting protects against abuse.</li>
              <li>Order verification is required before sensitive order actions.</li>
              <li>No card or payment details are ever collected in chat.</li>
            </ul>
          </InfoBanner>
        </CardContent>
      </Card>
    </div>
  );
}
