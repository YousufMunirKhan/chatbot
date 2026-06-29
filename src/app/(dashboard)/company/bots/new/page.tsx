import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { BotForm } from '@/modules/company/components/bot-form';
import { createBotAction } from '@/modules/company/actions';
import { getCurrentCompany, listBots } from '@/modules/company/data';

export default async function NewBotPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const [company, bots] = await Promise.all([getCurrentCompany(), listBots()]);
  const botLimit = company.subscription.botLimit;
  const atBotLimit = botLimit != null && bots.length >= botLimit;

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
      {atBotLimit ? (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div>
              <h2 className="text-lg font-semibold">Edit your existing assistant</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Your plan allows up to {botLimit} assistant{botLimit === 1 ? '' : 's'}. Change the
                assistant type, capabilities, and Help Desk settings from the existing assistant
                settings screen.
              </p>
            </div>
            <div className="space-y-2">
              {bots.map((bot) => (
                <div key={bot.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                  <div>
                    <p className="font-medium">{bot.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {bot.assistantAudience === 'internal' ? 'Internal Help Desk' : 'Customer website assistant'}
                    </p>
                  </div>
                  <Button asChild size="sm">
                    <Link href={`/company/bots/${bot.id}/settings`}>Edit</Link>
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <BotForm action={createBotAction} companyName={company.name} submitLabel="Create assistant" />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
