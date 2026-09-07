import { createSupabaseServiceClient } from '@/lib/db/server';
import { env } from '@/lib/env';
import { buildEmbedUrl } from '@/lib/embed/identity';
import { getCompanyId } from './data';

/**
 * Read side of the mobile embed kit.
 *
 * The secret itself is never returned here — only whether one exists. Revealing
 * it is an explicit, admin-only action (see mobile-embed-actions.ts), so a
 * signing key is not sitting in the HTML of a page anyone might screen-share.
 */

export interface MobileEmbedBot {
  botId: string;
  name: string;
  publicBotId: string;
  /** The URL the host app loads in its WebView, with no identity attached. */
  embedUrl: string;
  /** A worked example with a signed identity, for the docs panel. */
  exampleUrl: string;
  hasSecret: boolean;
}

export async function listMobileEmbedBots(): Promise<MobileEmbedBot[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('bots')
    .select('id,name,public_bot_id,mobile_embed_secret_encrypted,appearance_json,bot_type,capability_flags')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });

  return (data ?? [])
    .map((row) => row as Record<string, unknown>)
    .filter((row) => {
      // Same customer/internal split the widget page applies: an internal help
      // desk assistant must not be offered as a customer-app embed.
      const appearance = (row.appearance_json as Record<string, unknown> | null) ?? {};
      const caps = (row.capability_flags as string[]) ?? [];
      return !(
        appearance.assistantAudience === 'internal' ||
        row.bot_type === 'help_desk' ||
        caps.some((cap) => String(cap).startsWith('internal_'))
      );
    })
    .map((row) => {
      const publicBotId = row.public_bot_id as string;
      return {
        botId: row.id as string,
        name: row.name as string,
        publicBotId,
        embedUrl: buildEmbedUrl({ appUrl: env.NEXT_PUBLIC_APP_URL, publicBotId }),
        exampleUrl: buildEmbedUrl({
          appUrl: env.NEXT_PUBLIC_APP_URL,
          publicBotId,
          userId: 'CUSTOMER_ID',
          name: 'CUSTOMER_NAME',
          email: 'CUSTOMER_EMAIL',
          signature: 'HMAC_FROM_YOUR_SERVER',
        }),
        hasSecret: Boolean(row.mobile_embed_secret_encrypted),
      };
    });
}
