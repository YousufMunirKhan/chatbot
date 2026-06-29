import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Card, CardContent } from '@/components/ui/card';
import { getSupportSettings } from '@/modules/company/support-settings-data';
import { SupportSettingsForm } from '@/modules/company/components/support-settings-form';

export default async function SupportSettingsPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const settings = await getSupportSettings();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link href="/company/inbox" className="text-sm text-muted-foreground hover:underline">
          ← Inbox
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Support settings</h1>
        <p className="text-sm text-muted-foreground">
          Response-time targets, agent routing, and business hours for your team inbox.
        </p>
      </div>
      <Card>
        <CardContent className="p-5">
          <SupportSettingsForm settings={settings} />
        </CardContent>
      </Card>
    </div>
  );
}
