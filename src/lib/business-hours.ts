import { createSupabaseServiceClient } from '@/lib/db/server';
import { logger } from '@/lib/logger';
import { buildSchedule, isWithinBusinessHours, toZonedTime, type BusinessDay } from '@/lib/sla/schedule';

/**
 * Is the business open right now?
 *
 * Deliberately built on the SLA schedule helpers rather than a second parser:
 * opening hours are stored once and two different readings of "open" would
 * eventually disagree, which is exactly the kind of difference nobody notices
 * until a customer is told the shop is shut while it is serving.
 *
 * Returns null when the company has not filled its hours in — "unknown", which
 * callers must treat as "do not hide anything", not as "closed".
 */

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; open: boolean | null }>();

export function invalidateBusinessHoursCache(companyId?: string): void {
  if (companyId) cache.delete(companyId);
  else cache.clear();
}

export async function isCompanyOpenNow(companyId: string, now: Date = new Date()): Promise<boolean | null> {
  const cached = cache.get(companyId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.open;

  let open: boolean | null = null;
  try {
    const sb = createSupabaseServiceClient();
    const [hoursRes, locationRes] = await Promise.all([
      sb
        .from('company_business_hours')
        .select('day_of_week,is_closed,open_time,close_time')
        .eq('company_id', companyId)
        .is('location_id', null),
      sb
        .from('company_locations')
        .select('timezone,is_primary')
        .eq('company_id', companyId)
        .order('is_primary', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const days: BusinessDay[] = ((hoursRes.data ?? []) as unknown as Array<Record<string, unknown>>).map(
      (row) => ({
        dayOfWeek: row.day_of_week as number,
        isClosed: Boolean(row.is_closed),
        openTime: (row.open_time as string) ?? null,
        closeTime: (row.close_time as string) ?? null,
      }),
    );

    // Every day closed, or no rows at all, means "not configured" rather than
    // "shut forever" — a company that never filled the form still has customers.
    const schedule = buildSchedule(days);
    if (schedule.size === 0) {
      open = null;
    } else {
      const timeZone = ((locationRes.data as { timezone?: string | null } | null)?.timezone ?? null) || null;
      open = isWithinBusinessHours(toZonedTime(now, timeZone), schedule);
    }
  } catch (err) {
    logger.warn('Could not read business hours', {
      companyId,
      error: err instanceof Error ? err.message : String(err),
    });
    open = null;
  }

  cache.set(companyId, { at: Date.now(), open });
  return open;
}

export type BusinessHoursMode = 'any' | 'during_hours' | 'after_hours';

/**
 * Should something restricted to a part of the day be shown right now?
 *
 * Pure, so the rule is testable without a database. `isOpenNow === null` means
 * the hours are unknown and everything is shown — hiding a customer's only way
 * to get help because a form was left blank is the worse failure.
 */
export function matchesBusinessHours(mode: string | null | undefined, isOpenNow: boolean | null): boolean {
  const value = (mode ?? 'any') as BusinessHoursMode;
  if (value === 'any') return true;
  if (isOpenNow === null) return true;
  return value === 'during_hours' ? isOpenNow : !isOpenNow;
}
