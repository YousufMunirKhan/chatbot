import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { listBots } from '@/modules/company/data';
import { WidgetEmbedInstructions } from '@/modules/company/components/widget-embed-instructions';
import { env } from '@/lib/env';

export default async function WidgetPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const bots = (await listBots()).filter((bot) => bot.assistantAudience === 'customer');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Website Widget</h1>
        <p className="text-sm text-muted-foreground">
          Test your customer-facing assistant live below, then copy the snippet to add it to your website.
        </p>
      </div>

      {/* Train CTA */}
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
            Create a customer-facing assistant first to get a preview &amp; embed snippet.{' '}
            <Link href="/company/bots/new" className="text-primary hover:underline">
              New assistant
            </Link>
          </CardContent>
        </Card>
      ) : (
        bots.map((b) => {
          const embed = `<script src="${env.NEXT_PUBLIC_WIDGET_URL}" data-bot-id="${b.publicBotId}"></script>`;
          return (
            <Card key={b.id}>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="text-base">{b.name}</CardTitle>
                <div className="flex items-center gap-4 text-sm">
                  <Link href="/company/business-data?tab=knowledge" className="text-primary hover:underline">
                    Add data
                  </Link>
                  <Link href={`/company/bots/${b.id}/settings`} className="text-primary hover:underline">
                    Configure
                  </Link>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Live preview — the real widget, chattable */}
                <div>
                  <p className="mb-2 text-sm font-medium">Live preview</p>
                  <div className="overflow-hidden rounded-lg border">
                    <iframe
                      src={`/widget/preview.html?bot=${b.publicBotId}`}
                      title={`${b.name} live preview`}
                      className="h-[480px] w-full"
                    />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    This is exactly what visitors see. Click the chat bubble in the preview to test it.
                  </p>
                </div>

                <WidgetEmbedInstructions
                  embed={embed}
                  domainAllowlist={b.domainAllowlist}
                  settingsHref={`/company/bots/${b.id}/settings`}
                />
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
