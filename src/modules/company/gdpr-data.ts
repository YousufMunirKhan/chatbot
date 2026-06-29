import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from './data';

export interface DataRequest {
  id: string;
  requesterEmail: string;
  requestType: 'export' | 'delete';
  status: string;
  notes: string | null;
  createdAt: string;
  completedAt: string | null;
}

export async function listDataRequests(): Promise<DataRequest[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('data_subject_requests')
    .select('id,requester_email,request_type,status,notes,created_at,completed_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(100);
  return (data ?? []).map((r) => {
    const x = r as Record<string, unknown>;
    return {
      id: x.id as string,
      requesterEmail: x.requester_email as string,
      requestType: x.request_type as 'export' | 'delete',
      status: x.status as string,
      notes: (x.notes as string) ?? null,
      createdAt: x.created_at as string,
      completedAt: (x.completed_at as string) ?? null,
    };
  });
}
