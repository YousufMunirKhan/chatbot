import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getCurrentCompany, listBots } from '@/modules/company/data';
import { WidgetDesignStudio } from '@/modules/company/components/widget-design-studio';
import { env } from '@/lib/env';

export default async function WidgetPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const [company, allBots] = await Promise.all([getCurrentCompany(), listBots()]);
  const bots = allBots.filter((bot) => bot.assistantAudience === 'customer');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Website Widget</h1>
        <p className="text-sm text-muted-foreground">
          Design the customer-facing chat widget, preview it against different website backgrounds,
          then save it to update the live embed.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div>
            <p className="font-medium">Want better answers?</p>
            <p className="text-sm text-muted-foreground">
              Add the facts visitors ask about: services, prices, policies, FAQs, and opening hours.
            </p>
          </div>
          <Button asChild>
            <Link href="/company/business-data?tab=knowledge">Open business data</Link>
          </Button>
        </CardContent>
      </Card>

      {bots.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Create a customer-facing assistant first to get a preview and embed snippet.{' '}
            <Link href="/company/bots/new" className="text-primary hover:underline">
              New assistant
            </Link>
          </CardContent>
        </Card>
      ) : (
        bots.map((bot) => {
          const embed = `<script src="${env.NEXT_PUBLIC_WIDGET_URL}" data-bot-id="${bot.publicBotId}"></script>`;
          return (
            <Card key={bot.id}>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="text-base">{bot.name}</CardTitle>
                <div className="flex items-center gap-4 text-sm">
                  <Link href="/company/business-data?tab=knowledge" className="text-primary hover:underline">
                    Add data
                  </Link>
                  <Link href={`/company/bots/${bot.id}/settings`} className="text-primary hover:underline">
                    Full settings
                  </Link>
                </div>
              </CardHeader>
              <CardContent>
                <WidgetDesignStudio bot={bot} company={company} embed={embed} />
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
