import { createSupabaseServiceClient } from '@/lib/db/server';
import { decryptSecret } from '@/lib/crypto';
import { fetchWithRetry } from '@/lib/ai/http';

interface GoogleCalendarCreds {
  access_token?: string;
  calendar_id?: string;
  timezone?: string;
}

async function loadCreds(companyId: string): Promise<{ creds: GoogleCalendarCreds; calendarId: string } | null> {
  const sb = createSupabaseServiceClient();
  const { data: integration } = await sb
    .from('integration_accounts')
    .select('credentials_encrypted')
    .eq('company_id', companyId)
    .eq('provider', 'google_calendar')
    .eq('status', 'connected')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const enc = (integration as { credentials_encrypted?: string } | null)?.credentials_encrypted;
  if (!enc) return null;
  const creds = asCreds(enc);
  if (!creds.access_token) return null;
  return { creds, calendarId: creds.calendar_id || 'primary' };
}

/**
 * Check whether a requested appointment slot conflicts with the connected
 * Google Calendar (Issue #11). Returns `connected: false` when no calendar is
 * linked so booking proceeds as before; `busy: true` when the 30-min window is
 * already taken so the assistant can offer another time.
 */
export async function checkAppointmentSlotBusy(params: {
  companyId: string;
  preferredDate: string | null;
  preferredTime: string | null;
}): Promise<{ connected: boolean; busy: boolean }> {
  if (!params.preferredDate || !params.preferredTime) return { connected: false, busy: false };
  const loaded = await loadCreds(params.companyId);
  if (!loaded) return { connected: false, busy: false };
  const time = /^\d{1,2}:\d{2}/.test(params.preferredTime) ? params.preferredTime.slice(0, 5) : '09:00';
  const start = new Date(`${params.preferredDate}T${time}:00Z`);
  if (Number.isNaN(start.getTime())) return { connected: true, busy: false };
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  try {
    const res = await fetchWithRetry('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: { Authorization: `Bearer ${loaded.creds.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        items: [{ id: loaded.calendarId }],
      }),
    });
    if (!res.ok) return { connected: true, busy: false };
    const json = await res.json();
    const busySlots = json.calendars?.[loaded.calendarId]?.busy ?? [];
    return { connected: true, busy: busySlots.length > 0 };
  } catch {
    return { connected: true, busy: false };
  }
}

function asCreds(value: string | null): GoogleCalendarCreds {
  if (!value) return {};
  try {
    return JSON.parse(decryptSecret(value)) as GoogleCalendarCreds;
  } catch {
    return {};
  }
}

function toDateTime(date: string | null, time: string | null, timezone: string) {
  if (!date) return null;
  const start = `${date}T${time || '09:00'}:00`;
  return { dateTime: start, timeZone: timezone };
}

export async function createGoogleCalendarEventForAppointment(params: {
  companyId: string;
  appointmentId: string;
  summary: string;
  description?: string | null;
  preferredDate: string | null;
  preferredTime: string | null;
  attendeeEmail?: string | null;
}): Promise<void> {
  const sb = createSupabaseServiceClient();
  const { data: integration } = await sb
    .from('integration_accounts')
    .select('id,credentials_encrypted,status')
    .eq('company_id', params.companyId)
    .eq('provider', 'google_calendar')
    .eq('status', 'connected')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!integration) return;

  const creds = asCreds((integration as Record<string, unknown>).credentials_encrypted as string | null);
  const accessToken = creds.access_token;
  const calendarId = creds.calendar_id || 'primary';
  const timezone = creds.timezone || 'UTC';
  const start = toDateTime(params.preferredDate, params.preferredTime, timezone);
  if (!accessToken || !start) {
    await sb.from('google_calendar_events').insert({
      company_id: params.companyId,
      appointment_id: params.appointmentId,
      integration_id: integration.id,
      status: 'pending',
      error_message: accessToken ? 'Appointment date missing' : 'Google access token missing',
    });
    return;
  }

  const startDate = new Date(start.dateTime);
  const endDate = new Date(startDate.getTime() + 30 * 60 * 1000);
  try {
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: params.summary,
        description: params.description ?? undefined,
        start,
        end: { dateTime: endDate.toISOString().slice(0, 19), timeZone: timezone },
        attendees: params.attendeeEmail ? [{ email: params.attendeeEmail }] : undefined,
      }),
    });
    const json = await res.json().catch(() => ({}));
    await sb.from('google_calendar_events').insert({
      company_id: params.companyId,
      appointment_id: params.appointmentId,
      integration_id: integration.id,
      google_event_id: res.ok ? json.id ?? null : null,
      status: res.ok ? 'created' : 'failed',
      error_message: res.ok ? null : JSON.stringify(json).slice(0, 500),
    });
  } catch (err) {
    await sb.from('google_calendar_events').insert({
      company_id: params.companyId,
      appointment_id: params.appointmentId,
      integration_id: integration.id,
      status: 'failed',
      error_message: err instanceof Error ? err.message : String(err),
    });
  }
}
