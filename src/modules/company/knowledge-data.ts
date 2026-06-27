import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId, listBots } from './data';

/**
 * Knowledge-base data layer (Module 10). Every query is scoped to the SESSION
 * user's own `companyId` (via getCompanyId) so a company admin can only ever see
 * their own documents.
 */
export interface DocumentRow {
  id: string;
  title: string;
  sourceType: string;
  status: string;
  charCount: number;
  botName: string | null;
  createdAt: string;
}

export async function listDocuments(): Promise<DocumentRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();

  const { data, error } = await sb
    .from('documents')
    .select('id, title, source_type, status, char_count, bot_id, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  if (error) throw error;

  // Resolve bot_id → name from the company's own bots (already company-scoped).
  const bots = await listBots();
  const botNames = new Map<string, string>(bots.map((b) => [b.id, b.name]));

  return (data ?? []).map((d) => {
    const x = d as Record<string, unknown>;
    const botId = (x.bot_id as string) ?? null;
    return {
      id: x.id as string,
      title: x.title as string,
      sourceType: x.source_type as string,
      status: x.status as string,
      charCount: (x.char_count as number) ?? 0,
      botName: botId ? botNames.get(botId) ?? null : null,
      createdAt: x.created_at as string,
    };
  });
}
