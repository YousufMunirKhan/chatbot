import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { listCampaigns } from '@/modules/company/campaigns-data';
import { toggleCampaignAction, deleteCampaignAction } from '@/modules/company/campaigns-actions';
import { CampaignForm } from '@/modules/company/components/campaign-form';

async function toggle(formData: FormData) {
  'use server';
  await toggleCampaignAction(formData);
}
async function remove(formData: FormData) {
  'use server';
  await deleteCampaignAction(formData);
}

export default async function CampaignsPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const campaigns = await listCampaigns();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Proactive campaigns</h1>
        <p className="text-sm text-muted-foreground">
          Trigger a targeted chat message after a delay on matching pages — turn passive visitors into conversations.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New campaign</CardTitle>
          <CardDescription>Behaviour-triggered in-widget nudge.</CardDescription>
        </CardHeader>
        <CardContent>
          <CampaignForm />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {campaigns.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No campaigns yet.</p>
          ) : (
            <ul className="divide-y">
              {campaigns.map((c) => (
                <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{c.name}</span>
                      <Badge variant={c.status === 'active' ? 'success' : 'outline'}>{c.status}</Badge>
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">{c.message}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {c.matchUrl ? `On pages with “${c.matchUrl}”` : 'On all pages'} · after {c.delaySeconds}s
                      {c.autoOpen ? ' · auto-opens' : ''}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <form action={toggle}>
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="status" value={c.status === 'active' ? 'paused' : 'active'} />
                      <Button type="submit" size="sm" variant="outline">
                        {c.status === 'active' ? 'Pause' : 'Activate'}
                      </Button>
                    </form>
                    <form action={remove}>
                      <input type="hidden" name="id" value={c.id} />
                      <Button type="submit" size="sm" variant="ghost">
                        Delete
                      </Button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
