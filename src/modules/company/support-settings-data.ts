import { cache } from 'react';
import { getCompanyCoreRow } from '@/lib/company/company-core';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from './data';

/**
 * Support operations settings (SLA, business hours, routing). SLA/routing keys
 * are key/value rows in `company_settings`; every getter falls back to a
 * sensible default when a key is missing.
 *
 * Opening hours are NOT a support setting (Issue #16). `company_business_hours`
 * — the Business Data hours form, the same rows the bot answers "are you open?"
 * from — is the single source of truth, and `companies.timezone` is the single
 * source of truth for the zone (Issue #31). `company_settings.business_hours`
 * now only carries the `enabled` toggle; its legacy `days/start/end/timezone`
 * are still read as a fallback for companies that never filled in Business Data
 * hours, so their SLA behaviour is unchanged.
 */
export interface BusinessHoursDay {
  day: number; // 0=Sun … 6=Sat
  isClosed: boolean;
  open: string | null; // "09:00" — null means "no time set" (open all day)
  close: string | null;
}

export interface BusinessHours {
  enabled: boolean;
  days: number[]; // 0=Sun … 6=Sat
  start: string; // "09:00" — earliest opening across the open days
  end: string; // "17:00" — latest closing across the open days
  timezone: string; // IANA, e.g. "Asia/Dubai"
  /** Where the schedule came from. `business_data` rows win over the legacy JSON. */
  source: 'business_data' | 'settings_json';
  /** Per-day schedule; only set when `source === 'business_data'`. */
  schedule: BusinessHoursDay[] | null;
}

export interface SupportSettings {
  slaResponseMinutes: number;
  routingStrategy: 'most_recent' | 'round_robin';
  autoTicketConnectorFailures: boolean;
  connectorFailureTicketDelayMinutes: number;
  businessHours: BusinessHours;
}

export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  enabled: false,
  days: [1, 2, 3, 4, 5],
  start: '09:00',
  end: '17:00',
  timezone: 'UTC',
  source: 'settings_json',
  schedule: null,
};

export const DEFAULT_SUPPORT_SETTINGS: SupportSettings = {
  slaResponseMinutes: 5,
  routingStrategy: 'most_recent',
  autoTicketConnectorFailures: false,
  connectorFailureTicketDelayMinutes: 5,
  businessHours: DEFAULT_BUSINESS_HOURS,
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** `"09:00:00"` (Postgres `time`) → `"09:00"`; anything unusable → null. */
function readTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const hhmm = value.slice(0, 5);
  return TIME_RE.test(hhmm) ? hhmm : null;
}

function minutesOf(time: string): number {
  const [h = 0, m = 0] = time.split(':').map(Number);
  return h * 60 + m;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Collapse the 7 Business Data rows into the flat shape SLA tracking expects. */
function summarizeSchedule(schedule: BusinessHoursDay[]): { days: number[]; start: string; end: string } {
  const open = schedule.filter((d) => !d.isClosed);
  const days = open.map((d) => d.day).sort((a, b) => a - b);
  const starts = open.map((d) => d.open ?? '00:00');
  const ends = open.map((d) => d.close ?? '23:59');
  return {
    days,
    start: starts.length ? starts.reduce((a, b) => (minutesOf(b) < minutesOf(a) ? b : a)) : DEFAULT_BUSINESS_HOURS.start,
    end: ends.length ? ends.reduce((a, b) => (minutesOf(b) > minutesOf(a) ? b : a)) : DEFAULT_BUSINESS_HOURS.end,
  };
}

/**
 * `options.timezone` lets a caller that has ALREADY read the company row hand
 * the timezone over instead of making this reader fetch the same row again.
 * Every dashboard page reads `companies` for the header and the locale, so on
 * those pages the third read was pure waste — and a round trip here costs
 * ~230 ms. Callers that only know a company id (the SLA sweep, webhooks) pass
 * nothing and get the read.
 */
export async function getSupportSettingsFor(
  companyId: string,
  options?: { timezone?: string | null },
): Promise<SupportSettings> {
  const sb = createSupabaseServiceClient();
  const preloadedTimezone = options && 'timezone' in options;
  const [{ data }, { data: hourRows }, { data: company }] = await Promise.all([
    sb
      .from('company_settings')
      .select('key,value_json')
      .eq('company_id', companyId)
      .in('key', [
        'sla_response_minutes',
        'routing_strategy',
        'business_hours',
        'auto_ticket_connector_failures',
        'connector_failure_ticket_delay_minutes',
      ]),
    // Company-wide hours only (location overrides are not a support-wide schedule).
    sb
      .from('company_business_hours')
      .select('day_of_week,is_closed,open_time,close_time')
      .eq('company_id', companyId)
      .is('location_id', null)
      .order('day_of_week', { ascending: true }),
    preloadedTimezone
      ? Promise.resolve({ data: { timezone: options?.timezone ?? null } })
      : sb.from('companies').select('timezone').eq('id', companyId).maybeSingle(),
  ]);

  const map = new Map<string, unknown>();
  for (const row of data ?? []) {
    const r = row as { key: string; value_json: unknown };
    map.set(r.key, r.value_json);
  }

  const slaRaw = Number(map.get('sla_response_minutes'));
  const connectorDelayRaw = Number(map.get('connector_failure_ticket_delay_minutes'));
  const strategy = map.get('routing_strategy');
  const hours = map.get('business_hours') as Partial<BusinessHours> | undefined;

  const schedule: BusinessHoursDay[] = (hourRows ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      day: Number(r.day_of_week ?? 0),
      isClosed: Boolean(r.is_closed),
      open: readTime(r.open_time),
      close: readTime(r.close_time),
    };
  });

  const companyTimezone = nonEmpty((company as { timezone?: string | null } | null)?.timezone);
  const jsonTimezone = nonEmpty(hours?.timezone);
  const enabled = Boolean(hours?.enabled);

  // Business Data hours win. Companies that never filled them in keep the legacy
  // JSON schedule and its timezone verbatim so their SLA behaviour is untouched.
  const businessHours: BusinessHours = schedule.length
    ? {
        enabled,
        ...summarizeSchedule(schedule),
        timezone: companyTimezone ?? jsonTimezone ?? DEFAULT_BUSINESS_HOURS.timezone,
        source: 'business_data',
        schedule,
      }
    : {
        enabled,
        days: Array.isArray(hours?.days) ? (hours!.days as number[]) : DEFAULT_BUSINESS_HOURS.days,
        start: typeof hours?.start === 'string' ? hours!.start : DEFAULT_BUSINESS_HOURS.start,
        end: typeof hours?.end === 'string' ? hours!.end : DEFAULT_BUSINESS_HOURS.end,
        timezone: jsonTimezone ?? companyTimezone ?? DEFAULT_BUSINESS_HOURS.timezone,
        source: 'settings_json',
        schedule: null,
      };

  return {
    slaResponseMinutes: Number.isFinite(slaRaw) && slaRaw > 0 ? slaRaw : DEFAULT_SUPPORT_SETTINGS.slaResponseMinutes,
    routingStrategy: strategy === 'round_robin' ? 'round_robin' : 'most_recent',
    autoTicketConnectorFailures: Boolean(map.get('auto_ticket_connector_failures')),
    connectorFailureTicketDelayMinutes:
      Number.isFinite(connectorDelayRaw) && connectorDelayRaw > 0
        ? connectorDelayRaw
        : DEFAULT_SUPPORT_SETTINGS.connectorFailureTicketDelayMinutes,
    businessHours,
  };
}

export const getSupportSettings = cache(async function getSupportSettings(): Promise<SupportSettings> {
  const [companyId, company] = await Promise.all([getCompanyId(), getCompanyCoreRow()]);
  return getSupportSettingsFor(companyId, {
    timezone: (company?.timezone as string | null | undefined) ?? null,
  });
});

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
    if (day == null) return false;
    const minutesNow = Number(hourStr) * 60 + Number(minStr);

    // Business Data hours are per-day, so Saturday's 10:00-14:00 is respected
    // instead of the flattened week-wide window.
    const today = hours.schedule?.find((d) => d.day === day);
    if (today) {
      if (today.isClosed) return false;
      // "Open, no times set" means open all day rather than never open.
      return minutesNow >= minutesOf(today.open ?? '00:00') && minutesNow <= minutesOf(today.close ?? '23:59');
    }

    if (!hours.days.includes(day)) return false;
    const [sh = 0, sm = 0] = hours.start.split(':').map(Number);
    const [eh = 23, em = 59] = hours.end.split(':').map(Number);
    return minutesNow >= sh * 60 + sm && minutesNow <= eh * 60 + em;
  } catch {
    return true; // bad timezone → never block SLA tracking
  }
}
