import { createSupabaseServiceClient } from '@/lib/db/server';
import { getSessionUser } from '@/lib/auth';
import { isPushConfigured } from '@/lib/push/vapid';
import { getCompanyId } from './data';

/**
 * Read side of the phone-alert settings. Deliberately shows the signed-in
 * agent only their OWN devices: a subscription is a physical phone, and one
 * colleague seeing (or revoking) another's is neither useful nor appropriate.
 * The company-wide count is a bare number, which is the only part an admin
 * needs to know whether the feature is actually in use.
 */

export interface PushDeviceRow {
  id: string;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  failedCount: number;
}

export interface PushOverview {
  /** False when VAPID keys are missing — the whole feature is off server-side. */
  configured: boolean;
  myDevices: PushDeviceRow[];
  companyDeviceCount: number;
}

export async function getPushOverview(): Promise<PushOverview> {
  const companyId = await getCompanyId();
  const user = await getSessionUser();
  // getCompanyId already redirects an unauthenticated caller, so this is
  // belt-and-braces — but an empty string here would be sent to Postgres as a
  // uuid and blow up the whole page rather than showing no devices.
  if (!user) return { configured: isPushConfigured(), myDevices: [], companyDeviceCount: 0 };
  const sb = createSupabaseServiceClient();

  const [mine, all] = await Promise.all([
    sb
      .from('push_subscriptions')
      .select('id,user_agent,created_at,last_seen_at,failed_count')
      .eq('company_id', companyId)
      .eq('user_id', user.userId)
      .order('last_seen_at', { ascending: false }),
    sb
      .from('push_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId),
  ]);

  return {
    configured: isPushConfigured(),
    myDevices: (mine.data ?? []).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: r.id as string,
        userAgent: (r.user_agent as string) ?? null,
        createdAt: r.created_at as string,
        lastSeenAt: r.last_seen_at as string,
        failedCount: Number(r.failed_count ?? 0),
      };
    }),
    companyDeviceCount: all.count ?? 0,
  };
}
