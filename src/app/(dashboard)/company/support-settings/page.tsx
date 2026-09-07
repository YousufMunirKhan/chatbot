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
    // One form of short fields. At `max-w-6xl` it was a 1150px-wide column
    // holding a single number box — forms stay at a readable measure.
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        backTo={{ href: '/company/inbox', label: 'Inbox' }}
        title="Inbox rules"
        description="How quickly you promise to reply, who a handed-over chat goes to, and the hours that promise applies in."
      />
      <Card>
        <CardContent className="p-5">
          <SupportSettingsForm settings={settings} />
        </CardContent>
      </Card>
    </div>
  );
}
