import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CopyButton } from '@/components/copy-button';
import { BotForm } from '@/modules/company/components/bot-form';
import { PromptConfigForm } from '@/modules/company/components/prompt-config-form';
import { updateBotAction } from '@/modules/company/actions';
import { getBot, getCurrentCompany } from '@/modules/company/data';
import { loadPromptConfig } from '@/modules/company/prompt';
import { assembleSystemPrompt } from '@/lib/ai/prompts/assemble';
import { env } from '@/lib/env';

export default async function BotSettingsPage({ params }: { params: { id: string } }) {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const bot = await getBot(params.id);
  if (!bot) notFound();

  const [company, config] = await Promise.all([getCurrentCompany(), loadPromptConfig(bot.id)]);
  const assembledPrompt = assembleSystemPrompt({
    botType: bot.botType,
    assistantAudience: bot.assistantAudience,
    language: bot.languageDefault,
    businessName: company.name,
    capabilities: bot.capabilityFlags,
    config,
  });

  const embed = `<script src="${env.NEXT_PUBLIC_WIDGET_URL}" data-bot-id="${bot.publicBotId}"></script>`;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/company/bots" className="text-sm text-muted-foreground hover:underline">
          ← Assistants
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{bot.name}</h1>
        <p className="text-sm text-muted-foreground">Assistant settings</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
        </CardHeader>
        <CardContent>
          <BotForm action={updateBotAction} bot={bot} submitLabel="Save changes" />
        </CardContent>
      </Card>

      <details className="rounded-md border bg-card">
        <summary className="cursor-pointer px-6 py-4 font-semibold">Advanced prompt settings</summary>
        <div className="space-y-6 border-t p-6">
          <div>
            <h2 className="text-base font-semibold">Prompt &amp; behavior</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Optional tone and instruction controls. Most customers can leave this as-is.
            </p>
          </div>
          <PromptConfigForm botId={bot.id} botType={bot.botType} config={config} />
          <div>
            <h2 className="text-base font-semibold">Generated system prompt</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Technical preview generated from audience, capabilities, tone, and safety rules.
            </p>
            <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
              {assembledPrompt}
            </pre>
          </div>
        </div>
      </details>

      <Card>
        <CardHeader>
          <CardTitle>Embed snippet</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Paste this before <code>&lt;/body&gt;</code> on your website.
          </p>
          <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">{embed}</pre>
          <CopyButton value={embed} label="Copy snippet" />
        </CardContent>
      </Card>
    </div>
  );
}
