import { createSupabaseServiceClient } from '@/lib/db/server';
import { getMonthlyMessageCount, getSubscription } from '@/lib/billing';
import { getCompanyId } from './data';

/**
 * Company-scoped analytics (Module 20). All counts are bound to the SESSION
 * user's own `companyId` (never a request value). Cost is summed in JS from
 * `ai_usage_logs` rows for the current calendar month.
 */
export interface CompanyAnalytics {
  messagesThisMonth: number;
  messageLimit: number | null;
  aiCostThisMonth: number;
  leads: number;
  appointments: number;
  chatOrders: number;
  conversations: number;
  aiHandled: number;
  humanHandled: number;
}

function monthStartIso(): string {
  const since = new Date();
  since.setUTCDate(1);
  since.setUTCHours(0, 0, 0, 0);
  return since.toISOString();
}

export async function getCompanyAnalytics(): Promise<CompanyAnalytics> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();

  const countWhere = async (table: string): Promise<number> => {
    const { count } = await sb
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId);
    return count ?? 0;
  };

  const countConversationsByStatus = async (statuses: string[]): Promise<number> => {
    const { count } = await sb
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .in('status', statuses);
    return count ?? 0;
  };

  const sumCost = async (): Promise<number> => {
    const { data } = await sb
      .from('ai_usage_logs')
      .select('estimated_cost,created_at')
      .eq('company_id', companyId)
      .gte('created_at', monthStartIso());
    return (data ?? []).reduce((sum, r) => {
      const row = r as Record<string, unknown>;
      return sum + ((row.estimated_cost as number) ?? 0);
    }, 0);
  };

  const [
    messagesThisMonth,
    subscription,
    aiCostThisMonth,
    leads,
    appointments,
    chatOrders,
    conversations,
    aiHandled,
    humanHandled,
  ] = await Promise.all([
    getMonthlyMessageCount(companyId),
    getSubscription(companyId),
    sumCost(),
    countWhere('leads'),
    countWhere('appointments'),
    countWhere('chat_orders'),
    countWhere('conversations'),
    countConversationsByStatus(['ai_active', 'closed']),
    countConversationsByStatus(['human_active']),
  ]);

  return {
    messagesThisMonth,
    messageLimit: subscription?.messageLimit ?? null,
    aiCostThisMonth,
    leads,
    appointments,
    chatOrders,
    conversations,
    aiHandled,
    humanHandled,
  };
}
