import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { getSupportSettings } from '@/modules/company/support-settings-data';
import { SupportSettingsForm } from '@/modules/company/components/support-settings-form';

export default async function SupportSettingsPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const settings = await getSupportSettings();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        backTo={{ href: '/company/inbox', label: 'Inbox' }}
        title="Support settings"
        description="Response-time targets, agent routing, and business hours for your team inbox."
      />
      <Card>
        <CardContent className="p-5">
          <SupportSettingsForm settings={settings} />
        </CardContent>
      </Card>
    </div>
  );
}
