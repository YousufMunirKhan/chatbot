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
  createdAt: string;
}

export async function listBroadcasts(): Promise<BroadcastRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('broadcasts')
    .select('id,channel,subject,message,schedule_at,status,sent_count,created_at')
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
      createdAt: x.created_at as string,
    };
  });
}
