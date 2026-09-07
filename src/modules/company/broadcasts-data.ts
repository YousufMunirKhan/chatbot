import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from './data';

export interface BroadcastRow {
  id: string;
  channel: string;
  subject: string | null;
  message: string;
  scheduleAt: string | null;
  status: string;
  sentCount: number;
  failedCount: number;
  audience: string;
  audienceFilter: Record<string, unknown>;
  templateName: string | null;
  templateLanguage: string | null;
  createdAt: string;
}

export async function listBroadcasts(): Promise<BroadcastRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('broadcasts')
    .select(
      'id,channel,subject,message,schedule_at,status,sent_count,failed_count,audience,audience_filter,template_name,template_language,created_at',
    )
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(100);
  return (data ?? []).map((r) => {
    const x = r as Record<string, unknown>;
    return {
      id: x.id as string,
      channel: x.channel as string,
      subject: (x.subject as string) ?? null,
      message: x.message as string,
      scheduleAt: (x.schedule_at as string) ?? null,
      status: x.status as string,
      sentCount: (x.sent_count as number) ?? 0,
      failedCount: (x.failed_count as number) ?? 0,
      audience: (x.audience as string) ?? 'all_leads',
      audienceFilter: (x.audience_filter as Record<string, unknown>) ?? {},
      templateName: (x.template_name as string) ?? null,
      templateLanguage: (x.template_language as string) ?? null,
      createdAt: x.created_at as string,
    };
  });
}

/** Approved WhatsApp templates, for the broadcast composer's template picker. */
export async function listApprovedTemplateOptions(): Promise<Array<{ name: string; language: string }>> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('whatsapp_templates')
    .select('name,language')
    .eq('company_id', companyId)
    .eq('status', 'approved')
    .order('name', { ascending: true })
    .limit(200);
  return (data ?? []).map((r) => {
    const x = r as Record<string, unknown>;
    return { name: x.name as string, language: (x.language as string) ?? 'en_US' };
  });
}
