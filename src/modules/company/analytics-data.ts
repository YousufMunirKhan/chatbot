import { createSupabaseServiceClient } from '@/lib/db/server';
import { getReplyAllowanceUsage, type ReplyAllowanceUsage } from '@/lib/billing';
import { getCompanyId } from './data';

/**
 * Company-scoped analytics (Module 20). All counts are bound to the SESSION
 * user's own `companyId` (never a request value). Cost is summed in JS from
 * `ai_usage_logs` rows for the current calendar month.
 */
export interface CompanyAnalytics {
  messagesThisMonth: number;
  messageLimit: number | null;
  replyUsage: ReplyAllowanceUsage;
  totalChatMessagesThisMonth: number;
  leads: number;
  appointments: number;
  chatOrders: number;
  conversations: number;
  aiHandled: number;
  humanHandled: number;
  closed: number;
  /** Share of conversations the AI handled without escalating to a human (0–1). */
  deflectionRate: number | null;
  /** Share of conversations that reached a closed/resolved state (0–1). */
  resolutionRate: number | null;
  csatAverage: number | null;
  csatResponses: number;
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

  const countMonthlyMessages = async (): Promise<number> => {
    const { count } = await sb
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .gte('created_at', monthStartIso());
    return count ?? 0;
  };

  const loadCsat = async (): Promise<{ csatAverage: number | null; csatResponses: number }> => {
    const { data } = await sb
      .from('conversations')
      .select('csat_rating')
      .eq('company_id', companyId)
      .not('csat_rating', 'is', null)
      .limit(2000);
    const ratings = (data ?? [])
      .map((r) => (r as Record<string, unknown>).csat_rating as number)
      .filter((n) => typeof n === 'number' && n > 0);
    if (!ratings.length) return { csatAverage: null, csatResponses: 0 };
    return {
      csatAverage: ratings.reduce((sum, n) => sum + n, 0) / ratings.length,
      csatResponses: ratings.length,
    };
  };

  const [
    replyUsage,
    totalChatMessagesThisMonth,
    leads,
    appointments,
    chatOrders,
    conversations,
    aiHandled,
    humanHandled,
    closed,
    escalated,
    csat,
  ] = await Promise.all([
    getReplyAllowanceUsage(companyId),
    countMonthlyMessages(),
    countWhere('leads'),
    countWhere('appointments'),
    countWhere('chat_orders'),
    countWhere('conversations'),
    countConversationsByStatus(['ai_active', 'closed']),
    countConversationsByStatus(['human_active']),
    countConversationsByStatus(['closed']),
    countConversationsByStatus(['needs_human', 'human_active']),
    loadCsat(),
  ]);

  // Deflection = conversations the AI carried without ever escalating to a human.
  const deflectionRate = conversations > 0 ? Math.max(0, conversations - escalated) / conversations : null;
  const resolutionRate = conversations > 0 ? closed / conversations : null;

  return {
    messagesThisMonth: replyUsage.used,
    messageLimit: replyUsage.monthlyAllowance,
    replyUsage,
    totalChatMessagesThisMonth,
    leads,
    appointments,
    chatOrders,
    conversations,
    aiHandled,
    humanHandled,
    closed,
    deflectionRate,
    resolutionRate,
    csatAverage: csat.csatAverage,
    csatResponses: csat.csatResponses,
  };
}
