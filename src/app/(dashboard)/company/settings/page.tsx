import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoBanner } from '@/components/info-banner';
import { requireRole } from '@/lib/auth';
import { ROLES, DEFAULT_CHAT_RETENTION_DAYS } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from '@/modules/company/data';
import { RetentionForm } from '@/modules/company/components/retention-form';
import { DataRequestForm } from '@/modules/company/components/data-request-form';

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

export default async function CompanySettingsPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const retentionDays = await getRetentionDays();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Team &amp; Settings</h1>
        <p className="text-sm text-muted-foreground">People, billing, privacy, integrations, and advanced controls.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/company/agents" className="rounded-lg border bg-card p-4 hover:bg-muted/50">
          <p className="text-sm font-medium">Team</p>
          <p className="mt-1 text-xs text-muted-foreground">Agents, invites, and availability.</p>
        </Link>
        <Link href="/company/billing" className="rounded-lg border bg-card p-4 hover:bg-muted/50">
          <p className="text-sm font-medium">Billing</p>
          <p className="mt-1 text-xs text-muted-foreground">Plan, usage limits, and subscription.</p>
        </Link>
        <Link href="/company/integrations" className="rounded-lg border bg-card p-4 hover:bg-muted/50">
          <p className="text-sm font-medium">Integrations</p>
          <p className="mt-1 text-xs text-muted-foreground">Calendars, commerce, and data sync.</p>
        </Link>
        <Link href="/company/quick-actions" className="rounded-lg border bg-card p-4 hover:bg-muted/50">
          <p className="text-sm font-medium">Quick actions</p>
          <p className="mt-1 text-xs text-muted-foreground">Chat buttons and handoff shortcuts.</p>
        </Link>
        <Link href="/company/ai-controls" className="rounded-lg border bg-card p-4 hover:bg-muted/50">
          <p className="text-sm font-medium">AI controls</p>
          <p className="mt-1 text-xs text-muted-foreground">Routing, provider, and model controls.</p>
        </Link>
        <Link href="/company/quality" className="rounded-lg border bg-card p-4 hover:bg-muted/50">
          <p className="text-sm font-medium">Quality</p>
          <p className="mt-1 text-xs text-muted-foreground">Feedback and answer evaluation.</p>
        </Link>
        <Link href="/company/usage" className="rounded-lg border bg-card p-4 hover:bg-muted/50">
          <p className="text-sm font-medium">Usage</p>
          <p className="mt-1 text-xs text-muted-foreground">Messages, cost, and limits.</p>
        </Link>
        <Link href="/company/security" className="rounded-lg border bg-card p-4 hover:bg-muted/50">
          <p className="text-sm font-medium">Security</p>
          <p className="mt-1 text-xs text-muted-foreground">Access, privacy, and protections.</p>
        </Link>
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
            <ul className="list-disc space-y-1 pl-5">
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
