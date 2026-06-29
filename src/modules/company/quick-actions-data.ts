import { createSupabaseServiceClient } from '@/lib/db/server';
import {
  mapQuickAction,
  serializeFormSchema,
  type QuickActionAudience,
  type QuickActionContextMode,
  type QuickActionPublic,
  type QuickActionSource,
  type QuickActionType,
} from '@/lib/quick-actions';
import { getCompanyId, listBots } from './data';

export interface QuickActionRow extends QuickActionPublic {
  botId: string | null;
  audience: QuickActionAudience;
  source: QuickActionSource;
  contextMode: QuickActionContextMode;
  contexts: string[];
  keywordTriggers: string[];
  pageUrlPatterns: string[];
  requiredCapabilities: string[];
  businessHoursMode: string;
  conversationStatuses: string[];
  priority: number;
  isActive: boolean;
  formSchemaText: string;
}

function mapRow(row: Record<string, unknown>): QuickActionRow {
  const publicRow = mapQuickAction(row);
  return {
    ...publicRow,
    actionType: row.action_type as QuickActionType,
    botId: (row.bot_id as string) ?? null,
    audience: publicRow.audience,
    source: publicRow.source,
    contextMode: publicRow.contextMode,
    contexts: (row.contexts as string[]) ?? [],
    keywordTriggers: (row.keyword_triggers as string[]) ?? [],
    pageUrlPatterns: (row.page_url_patterns as string[]) ?? [],
    requiredCapabilities: (row.required_capabilities as string[]) ?? [],
    businessHoursMode: (row.business_hours_mode as string) ?? 'any',
    conversationStatuses: (row.conversation_statuses as string[]) ?? [],
    priority: (row.priority as number) ?? 100,
    isActive: Boolean(row.is_active),
    formSchemaText: serializeFormSchema(row.form_schema_json),
  };
}

export async function listQuickActions(): Promise<{ actions: QuickActionRow[]; bots: Awaited<ReturnType<typeof listBots>> }> {
  const companyId = await getCompanyId();
  const [bots, rows] = await Promise.all([
    listBots(),
    createSupabaseServiceClient()
      .from('bot_quick_actions')
      .select('*')
      .eq('company_id', companyId)
      .order('priority', { ascending: true })
      .order('created_at', { ascending: false }),
  ]);
  if (rows.error) throw rows.error;
  return {
    bots,
    actions: ((rows.data ?? []) as Array<Record<string, unknown>>).map(mapRow),
  };
}
