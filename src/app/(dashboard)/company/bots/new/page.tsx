import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Card, CardContent } from '@/components/ui/card';
import { BotForm } from '@/modules/company/components/bot-form';
import { createBotAction } from '@/modules/company/actions';
import { getCurrentCompany } from '@/modules/company/data';

export default async function NewBotPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const company = await getCurrentCompany();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/company/bots" className="text-sm text-muted-foreground hover:underline">
          ← Assistants
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">New assistant</h1>
        <p className="text-sm text-muted-foreground">
          Pick a type and capabilities. Prompt templates &amp; advanced tuning come in Module 6.
        </p>
      </div>
      <Card>
        <CardContent className="pt-6">
          <BotForm action={createBotAction} companyName={company.name} submitLabel="Create assistant" />
        </CardContent>
      </Card>
    </div>
  );
}
