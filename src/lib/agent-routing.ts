import { createSupabaseServiceClient } from '@/lib/db/server';
import { getSupportSettingsFor } from '@/modules/company/support-settings-data';

export async function assignBestAvailableAgent(companyId: string, conversationId: string): Promise<string | null> {
  const sb = createSupabaseServiceClient();
  const { data: agents } = await sb
    .from('agent_presence')
    .select('user_id,status,last_seen_at')
    .eq('company_id', companyId)
    .eq('status', 'online')
    .order('last_seen_at', { ascending: false })
    .limit(25);
  const online = (agents ?? []).map((a) => (a as { user_id: string }).user_id).filter(Boolean);
  const first = online[0];
  if (!first) return null;

  const { routingStrategy } = await getSupportSettingsFor(companyId);
  let agent: string = first;

  if (routingStrategy === 'round_robin') {
    // Load-balance: pick the online agent with the fewest active (open) chats.
    const { data: openConvos } = await sb
      .from('conversations')
      .select('assigned_agent_id')
      .eq('company_id', companyId)
      .in('status', ['needs_human', 'human_active']);
    const load = new Map<string, number>();
    online.forEach((id) => load.set(id, 0));
    for (const row of openConvos ?? []) {
      const id = (row as { assigned_agent_id: string | null }).assigned_agent_id;
      if (id && load.has(id)) load.set(id, (load.get(id) ?? 0) + 1);
    }
    agent = online.reduce((best, id) => ((load.get(id) ?? 0) < (load.get(best) ?? 0) ? id : best), first);
  }

  await sb
    .from('conversations')
    .update({ assigned_agent_id: agent, status: 'needs_human', ai_enabled: false })
    .eq('company_id', companyId)
    .eq('id', conversationId);
  return agent;
}
