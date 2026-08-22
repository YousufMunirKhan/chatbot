import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { getCurrentCompany, listBots } from '@/modules/company/data';
import { WidgetDesignStudio } from '@/modules/company/components/widget-design-studio';
import { TestAssistant } from '@/modules/company/components/test-assistant';
import { env } from '@/lib/env';

export default async function WidgetPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const [company, allBots] = await Promise.all([getCurrentCompany(), listBots()]);
  const bots = allBots.filter((bot) => bot.assistantAudience === 'customer');

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Website Widget"
        description="Design the customer-facing chat widget, preview it against different website backgrounds, then save it to update the live embed."
      />

      {/* The setup wizard's test step lands here, so the real test tool sits above
          the design studio — the studio preview is a design mock, not a chat. */}
      <div id="test-assistant" className="scroll-mt-6">
        <TestAssistant />
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
          <CardContent className="p-0">
            <EmptyState
              title="Create a customer-facing assistant first to get a preview and embed snippet."
              action={
                <Button asChild size="sm">
                  <Link href="/company/bots/new">New assistant</Link>
                </Button>
              }
            />
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
