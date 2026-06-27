import { createSupabaseServiceClient } from '@/lib/db/server';

export async function assignBestAvailableAgent(companyId: string, conversationId: string): Promise<string | null> {
  const sb = createSupabaseServiceClient();
  const { data: agents } = await sb
    .from('agent_presence')
    .select('user_id,status,last_seen_at')
    .eq('company_id', companyId)
    .eq('status', 'online')
    .order('last_seen_at', { ascending: false })
    .limit(10);
  const agent = agents?.[0]?.user_id as string | undefined;
  if (!agent) return null;
  await sb
    .from('conversations')
    .update({ assigned_agent_id: agent, status: 'needs_human', ai_enabled: false })
    .eq('company_id', companyId)
    .eq('id', conversationId);
  return agent;
}
