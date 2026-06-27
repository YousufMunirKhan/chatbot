import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from './data';

/**
 * Notifications data layer (Module 24). Every query is bound to the SESSION
 * user's own `companyId` so company admins and agents only see their own
 * company's notifications.
 */

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read: boolean;
  createdAt: string;
}

export async function listNotifications(): Promise<NotificationRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('notifications')
    .select('id,type,title,body,read,created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []).map((row) => {
    const n = row as Record<string, unknown>;
    return {
      id: n.id as string,
      type: n.type as string,
      title: (n.title as string) ?? '',
      body: (n.body as string) ?? null,
      read: Boolean(n.read),
      createdAt: n.created_at as string,
    };
  });
}

export async function unreadCount(): Promise<number> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { count, error } = await sb
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('read', false);
  if (error) throw error;
  return count ?? 0;
}
