import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from './data';

export interface Campaign {
  id: string;
  name: string;
  status: string;
  matchUrl: string | null;
  delaySeconds: number;
  message: string;
  autoOpen: boolean;
  priority: number;
}

export interface ProactiveRule {
  matchUrl: string | null;
  delaySeconds: number;
  message: string;
  autoOpen: boolean;
}

export async function listCampaigns(): Promise<Campaign[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('proactive_campaigns')
    .select('id,name,status,match_url,delay_seconds,message,auto_open,priority')
    .eq('company_id', companyId)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(200);
  return (data ?? []).map(mapCampaign);
}

function mapCampaign(r: unknown): Campaign {
  const x = r as Record<string, unknown>;
  return {
    id: x.id as string,
    name: x.name as string,
    status: x.status as string,
    matchUrl: (x.match_url as string) ?? null,
    delaySeconds: (x.delay_seconds as number) ?? 8,
    message: x.message as string,
    autoOpen: Boolean(x.auto_open),
    priority: (x.priority as number) ?? 0,
  };
}

/** Active web-proactive rules for a bot, consumed by the public widget config. */
export async function getActiveWebProactiveRules(companyId: string, botId: string): Promise<ProactiveRule[]> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('proactive_campaigns')
    .select('match_url,delay_seconds,message,auto_open,priority')
    .eq('company_id', companyId)
    .eq('status', 'active')
    .eq('type', 'web_proactive')
    .or(`bot_id.eq.${botId},bot_id.is.null`)
    .order('priority', { ascending: false })
    .limit(25);
  return (data ?? []).map((r) => {
    const x = r as Record<string, unknown>;
    return {
      matchUrl: (x.match_url as string) ?? null,
      delaySeconds: (x.delay_seconds as number) ?? 8,
      message: x.message as string,
      autoOpen: Boolean(x.auto_open),
    };
  });
}
