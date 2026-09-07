import { requireRole } from '@/lib/auth';
import { ACTIVATION_STATUS_LABELS, ROLES, labelFor } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { UpgradeNotice } from '@/components/ui/upgrade-notice';
import { companyHasFeature, requireCompanyFeature } from '@/lib/entitlements';
import { listCampaigns } from '@/modules/company/campaigns-data';
import { toggleCampaignAction, deleteCampaignAction } from '@/modules/company/campaigns-actions';
import { CampaignForm } from '@/modules/company/components/campaign-form';
import { ConfirmSubmit } from '@/components/confirm-submit';

// The gate below decides what this page draws; these decide what a post can do.
// A form that is never rendered is still reachable with a crafted request.
async function toggle(formData: FormData) {
  'use server';
  await requireCompanyFeature('campaigns');
  await toggleCampaignAction(formData);
}
async function remove(formData: FormData) {
  'use server';
  await requireCompanyFeature('campaigns');
  await deleteCampaignAction(formData);
}

export default async function CampaignsPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  if (!(await companyHasFeature('campaigns'))) return <UpgradeNotice feature="campaigns" />;

  const campaigns = await listCampaigns();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Chat invites"
        description="Open the chat by itself with a friendly line, after someone has been on a page for a while — “Need a hand choosing a size?”. It turns people who were about to leave into people who ask."
      />

      {/* Desktop: what you have already sent on the left, the composer on the
          right. They were stacked, so the list you came to check sat below a
          form you had already used. `min-w-0` on the children because a long
          message line in a `1fr` track stretches it and pushes the page
          sideways. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <div className="space-y-6">
          <Card>
            <CardContent className="p-0">
              {campaigns.length === 0 ? (
                // Module 1 — the create form is on this page, so link straight to it.
                <EmptyState
                  title="You have no chat invites yet"
                  body="A campaign opens the chat with a message you choose, on the pages you choose, after a delay you set. A good first one: offer help on your pricing page after 20 seconds."
                  action={
                    <Button asChild size="sm">
                      <a href="#new-campaign">Write a chat invite</a>
                    </Button>
                  }
                />
              ) : (
                <ul className="divide-y">
                  {campaigns.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{c.name}</span>
                          <Badge variant={c.status === 'active' ? 'success' : 'outline'}>
                            {labelFor(ACTIVATION_STATUS_LABELS, c.status)}
                          </Badge>
                        </div>
                        <p className="mt-0.5 text-sm text-muted-foreground">{c.message}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {c.matchUrl ? `On pages with “${c.matchUrl}”` : 'On all pages'} · after{' '}
                          {c.delaySeconds}s{c.autoOpen ? ' · auto-opens' : ''}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <form action={toggle}>
                          <input type="hidden" name="id" value={c.id} />
                          <input
                            type="hidden"
                            name="status"
                            value={c.status === 'active' ? 'paused' : 'active'}
                          />
                          <Button type="submit" size="sm" variant="outline">
                            {c.status === 'active' ? 'Stop showing this' : 'Start showing this'}
                          </Button>
                        </form>
                        <form action={remove}>
                          <input type="hidden" name="id" value={c.id} />
                          <ConfirmSubmit
                            label="Delete this invite"
                            confirmLabel="Yes, delete it"
                            question={`“${c.name}” stops appearing on your website and its wording is lost. This cannot be undone.`}
                          />
                        </form>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sticky on desktop: you write the next one while reading what the
            last one said, so the composer must not scroll away with the list. */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <Card id="new-campaign">
            <CardHeader>
              <CardTitle>Write a new chat invite</CardTitle>
              <CardDescription>
                Choose the words, the pages it appears on, and how long to wait before it shows.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CampaignForm />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
