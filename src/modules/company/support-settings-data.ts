import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from './data';

/**
 * Support operations settings (SLA, business hours, routing). Stored as
 * key/value rows in `company_settings` so no new table is needed. Every getter
 * falls back to a sensible default when a key is missing.
 */
export interface BusinessHours {
  enabled: boolean;
  days: number[]; // 0=Sun … 6=Sat
  start: string; // "09:00"
  end: string; // "17:00"
  timezone: string; // IANA, e.g. "Asia/Dubai"
}

export interface SupportSettings {
  slaResponseMinutes: number;
  routingStrategy: 'most_recent' | 'round_robin';
  businessHours: BusinessHours;
}

export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  enabled: false,
  days: [1, 2, 3, 4, 5],
  start: '09:00',
  end: '17:00',
  timezone: 'UTC',
};

export const DEFAULT_SUPPORT_SETTINGS: SupportSettings = {
  slaResponseMinutes: 5,
  routingStrategy: 'most_recent',
  businessHours: DEFAULT_BUSINESS_HOURS,
};

export async function getSupportSettingsFor(companyId: string): Promise<SupportSettings> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('company_settings')
    .select('key,value_json')
    .eq('company_id', companyId)
    .in('key', ['sla_response_minutes', 'routing_strategy', 'business_hours']);

  const map = new Map<string, unknown>();
  for (const row of data ?? []) {
    const r = row as { key: string; value_json: unknown };
    map.set(r.key, r.value_json);
  }

  const slaRaw = Number(map.get('sla_response_minutes'));
  const strategy = map.get('routing_strategy');
  const hours = map.get('business_hours') as Partial<BusinessHours> | undefined;

  return {
    slaResponseMinutes: Number.isFinite(slaRaw) && slaRaw > 0 ? slaRaw : DEFAULT_SUPPORT_SETTINGS.slaResponseMinutes,
    routingStrategy: strategy === 'round_robin' ? 'round_robin' : 'most_recent',
    businessHours: {
      enabled: Boolean(hours?.enabled),
      days: Array.isArray(hours?.days) ? (hours!.days as number[]) : DEFAULT_BUSINESS_HOURS.days,
      start: typeof hours?.start === 'string' ? hours!.start : DEFAULT_BUSINESS_HOURS.start,
      end: typeof hours?.end === 'string' ? hours!.end : DEFAULT_BUSINESS_HOURS.end,
      timezone: typeof hours?.timezone === 'string' ? hours!.timezone : DEFAULT_BUSINESS_HOURS.timezone,
    },
  };
}

export async function getSupportSettings(): Promise<SupportSettings> {
  return getSupportSettingsFor(await getCompanyId());
}

/** Is `now` inside the configured business hours (in the configured timezone)? */
export function isWithinBusinessHours(hours: BusinessHours, now: Date = new Date()): boolean {
  if (!hours.enabled) return true;
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: hours.timezone,
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const weekdayStr = parts.find((p) => p.type === 'weekday')?.value ?? '';
    const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '0';
    const minStr = parts.find((p) => p.type === 'minute')?.value ?? '0';
    const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const day = weekdayMap[weekdayStr];
    if (day == null || !hours.days.includes(day)) return false;
    const minutesNow = Number(hourStr) * 60 + Number(minStr);
    const [sh = 0, sm = 0] = hours.start.split(':').map(Number);
    const [eh = 23, em = 59] = hours.end.split(':').map(Number);
    return minutesNow >= sh * 60 + sm && minutesNow <= eh * 60 + em;
  } catch {
    return true; // bad timezone → never block SLA tracking
  }
}
