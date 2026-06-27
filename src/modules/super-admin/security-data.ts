import { createSupabaseServiceClient } from '@/lib/db/server';

export interface SecurityLogRow {
  id: string;
  eventType: string;
  createdAt: string;
  ip: string | null;
  userEmail: string | null;
  companyName: string | null;
}

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

export async function listSecurityLogs(limit = 100): Promise<SecurityLogRow[]> {
  const { data, error } = await createSupabaseServiceClient()
    .from('security_audit_logs')
    .select('id,event_type,created_at,ip_address,users(email),companies(name)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row) => {
    const user = one(row.users as { email?: string } | { email?: string }[] | null);
    const company = one(row.companies as { name?: string } | { name?: string }[] | null);
    return {
      id: row.id as string,
      eventType: row.event_type as string,
      createdAt: row.created_at as string,
      ip: (row.ip_address as string) ?? null,
      userEmail: user?.email ?? null,
      companyName: company?.name ?? null,
    };
  });
}
