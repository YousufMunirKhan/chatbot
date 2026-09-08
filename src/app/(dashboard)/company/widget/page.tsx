import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { getCurrentCompany, listBots } from '@/modules/company/data';
import { listMobileEmbedBots } from '@/modules/company/mobile-embed-data';
import { MobileEmbedKit } from '@/modules/company/components/mobile-embed-kit';
import { WidgetDesignStudio } from '@/modules/company/components/widget-design-studio';
import { TestAssistant } from '@/modules/company/components/test-assistant';
import { env } from '@/lib/env';

export default async function WidgetPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const [company, allBots, mobileBots] = await Promise.all([
    getCurrentCompany(),
    listBots(),
    listMobileEmbedBots(),
  ]);
  const bots = allBots.filter((bot) => bot.assistantAudience === 'customer');

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Website chat"
        description="The chat bubble your customers see on your own website. Choose how it looks, try it out here, then copy one line of code onto your site to switch it on."
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
              title="You need an assistant first"
              body="The chat on your website is the front of an assistant, so there has to be one to put there. It takes a couple of minutes to create."
              action={
                <Button asChild size="sm">
                  <Link href="/company/bots/new">Create my assistant</Link>
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
              {/* `CardHeader` is `flex flex-col space-y-1.5`; overriding only
                  `flex-row` left the `space-y-1.5` behind, so the link pair got
                  a 6px top margin and sat off the centre line `items-center`
                  had just put them on. `space-y-0` removes it, and `flex-wrap`
                  stops a long assistant name crushing both links at 375px. */}
              <CardHeader className="flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 space-y-0">
                <CardTitle className="text-base">{bot.name}</CardTitle>
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <Link
                    href="/company/business-data?tab=knowledge"
                    className="text-primary hover:underline"
                  >
                    Add data
                  </Link>
                  <Link
                    href={`/company/bots/${bot.id}/settings`}
                    className="text-primary hover:underline"
                  >
                    Full settings
                    <span className="sr-only"> for {bot.name}</span>
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

      {mobileBots.length > 0 ? (
        <Card id="mobile-app">
          <CardHeader>
            <CardTitle className="text-base">Inside your own mobile app</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              The same chat, the same inbox, the same assistant — running full screen inside your
              Android or iOS app. Your developer loads one address in a WebView; there is no SDK to
              add and nothing to release through the app stores when you change the chat.
            </p>
            <MobileEmbedKit bots={mobileBots} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
