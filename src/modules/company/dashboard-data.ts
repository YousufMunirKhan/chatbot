import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId, getCurrentCompany } from './data';

export interface CompanyDashboardSummary {
  company: Awaited<ReturnType<typeof getCurrentCompany>>;
  botCount: number;
  memberCount: number;
  activeConversations: number;
  leads: number;
  appointments: number;
  chatOrders: number;
  syncedOrders: number;
  customerWork: number;
}

async function countRows(
  table: string,
  companyId: string,
): Promise<number> {
  const sb = createSupabaseServiceClient();
  const { count, error } = await sb
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId);
  if (error) throw error;
  return count ?? 0;
}

async function countActiveConversations(companyId: string): Promise<number> {
  const sb = createSupabaseServiceClient();
  const { count, error } = await sb
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .neq('status', 'closed');
  if (error) throw error;
  return count ?? 0;
}

export async function getCompanyDashboardSummary(): Promise<CompanyDashboardSummary> {
  const companyId = await getCompanyId();
  const [
    company,
    botCount,
    memberCount,
    activeConversations,
    leads,
    appointments,
    chatOrders,
    syncedOrders,
  ] = await Promise.all([
    getCurrentCompany(),
    countRows('bots', companyId),
    countRows('company_users', companyId),
    countActiveConversations(companyId),
    countRows('leads', companyId),
    countRows('appointments', companyId),
    countRows('chat_orders', companyId),
    countRows('synced_orders', companyId),
  ]);

  return {
    company,
    botCount,
    memberCount,
    activeConversations,
    leads,
    appointments,
    chatOrders,
    syncedOrders,
    customerWork: leads + appointments + chatOrders + syncedOrders,
  };
}
