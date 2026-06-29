import { createSupabaseServiceClient } from '@/lib/db/server';
import { decryptSecret } from '@/lib/crypto';
import type { BotContext } from '@/lib/ai/engine';
import { loadBotByPublicId } from '@/lib/ai/engine';

export interface ChannelIdentity {
  companyId: string;
  botPublicId: string | null;
  channel: string;
  externalId: string;
  secret: string | null;
  settings: Record<string, unknown>;
}

/** Resolve the company/bot/token that owns an inbound channel address. */
export async function resolveChannelIdentity(
  channel: string,
  externalId: string,
): Promise<{ identity: ChannelIdentity; bot: BotContext | null } | null> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('channel_identities')
    .select('company_id,bot_id,channel,external_id,secret_encrypted,settings_json,is_active,bots(public_bot_id)')
    .eq('channel', channel)
    .eq('external_id', externalId)
    .maybeSingle();
  if (!data) return null;
  const row = data as Record<string, unknown>;
  if (row.is_active === false) return null;

  let secret: string | null = null;
  const enc = row.secret_encrypted as string | null;
  if (enc) {
    try {
      secret = decryptSecret(enc);
    } catch {
      secret = enc; // tolerate a plaintext token in dev/test
    }
  }

  const botJoin = row.bots as { public_bot_id?: string } | null;
  const botPublicId = botJoin?.public_bot_id ?? null;
  const identity: ChannelIdentity = {
    companyId: row.company_id as string,
    botPublicId,
    channel: row.channel as string,
    externalId: row.external_id as string,
    secret,
    settings: (row.settings_json as Record<string, unknown>) ?? {},
  };

  // TENANT ISOLATION: the answering bot MUST belong to the same company as the
  // channel. Even if a bad bot_id were ever stored, never serve another
  // company's bot — fall back to this company's own customer bot instead.
  let bot = botPublicId ? await loadBotByPublicId(botPublicId) : null;
  if (bot && bot.companyId !== identity.companyId) bot = null;
  if (!bot) bot = await firstCustomerBot(identity.companyId);
  return { identity, bot };
}

async function firstCustomerBot(companyId: string): Promise<BotContext | null> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('bots')
    .select('public_bot_id,appearance_json,created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: true })
    .limit(50);
  const rows = (data ?? []) as Array<{ public_bot_id: string; appearance_json: Record<string, unknown> | null }>;
  const pick = rows.find((r) => (r.appearance_json?.assistantAudience ?? 'customer') !== 'internal') ?? rows[0];
  return pick ? loadBotByPublicId(pick.public_bot_id) : null;
}
