import { getSessionUser } from '@/lib/auth';
import { createSupabaseServiceClient } from '@/lib/db/server';

export interface MySecuritySettings {
  twoFactorEnabled: boolean;
  lastLoginAt: string | null;
  recentEvents: Array<{ id: string; eventType: string; createdAt: string; ip: string | null }>;
}

export async function getMySecuritySettings(): Promise<MySecuritySettings> {
  const user = await getSessionUser();
  if (!user) return { twoFactorEnabled: false, lastLoginAt: null, recentEvents: [] };
  const sb = createSupabaseServiceClient();
  const [{ data: settings }, { data: events }] = await Promise.all([
    sb.from('user_security_settings').select('two_factor_enabled,last_login_at').eq('user_id', user.userId).maybeSingle(),
    sb
      .from('security_audit_logs')
      .select('id,event_type,created_at,ip_address')
      .eq('user_id', user.userId)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);
  return {
    twoFactorEnabled: Boolean(settings?.two_factor_enabled),
    lastLoginAt: (settings?.last_login_at as string) ?? null,
    recentEvents: (events ?? []).map((event) => ({
      id: event.id as string,
      eventType: event.event_type as string,
      createdAt: event.created_at as string,
      ip: (event.ip_address as string) ?? null,
    })),
  };
}
