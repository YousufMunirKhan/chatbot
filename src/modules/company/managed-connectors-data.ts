import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from './data';

export interface ManagedConnectorRow {
  id: string;
  connectorId: string;
  platform: string;
  status: string;
  name: string;
  createdAt: string;
}

export async function listManagedConnectors(): Promise<ManagedConnectorRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('managed_connectors')
    .select('id,connector_id,platform,status,created_at,helpdesk_connectors(name)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(50);
  return (data ?? []).map((r) => {
    const x = r as Record<string, unknown>;
    const conn = x.helpdesk_connectors as { name?: string } | null;
    return {
      id: x.id as string,
      connectorId: x.connector_id as string,
      platform: x.platform as string,
      status: x.status as string,
      name: conn?.name ?? (x.platform as string),
      createdAt: x.created_at as string,
    };
  });
}
