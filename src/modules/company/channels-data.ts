import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from './data';

export interface ChannelIdentityRow {
  id: string;
  channel: string;
  externalId: string;
  botId: string | null;
  isActive: boolean;
  hasSecret: boolean;
  createdAt: string;
}

export async function listChannelIdentities(): Promise<ChannelIdentityRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('channel_identities')
    .select('id,channel,external_id,bot_id,is_active,secret_encrypted,created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(100);
  return (data ?? []).map((r) => {
    const x = r as Record<string, unknown>;
    return {
      id: x.id as string,
      channel: x.channel as string,
      externalId: x.external_id as string,
      botId: (x.bot_id as string) ?? null,
      isActive: x.is_active !== false,
      hasSecret: Boolean(x.secret_encrypted),
      createdAt: x.created_at as string,
    };
  });
}
