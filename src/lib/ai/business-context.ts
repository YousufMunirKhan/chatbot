import { createSupabaseServiceClient } from '@/lib/db/server';

type SB = ReturnType<typeof createSupabaseServiceClient>;

const MAX_CONTEXT_CHARS = 2200;

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function money(from: unknown, to: unknown, currency: unknown): string {
  const c = text(currency) || 'USD';
  const a = typeof from === 'number' || typeof from === 'string' ? Number(from) : NaN;
  const b = typeof to === 'number' || typeof to === 'string' ? Number(to) : NaN;
  if (!Number.isNaN(a) && !Number.isNaN(b) && a !== b) return `${a}-${b} ${c}`;
  if (!Number.isNaN(a)) return `${a} ${c}`;
  if (!Number.isNaN(b)) return `${b} ${c}`;
  return '';
}

function line(label: string, value: unknown): string | null {
  const v = Array.isArray(value) ? value.filter(Boolean).join(', ') : text(value);
  return v ? `${label}: ${v}` : null;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 3)).trim()}...`;
}

function weekday(n: number): string {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][n] ?? String(n);
}

// Short-TTL cache so runtime injection (Issue #18) stays fresh without a
// 6-query round-trip on every single chat turn.
const CONTEXT_TTL_MS = 60_000;
const contextCache = new Map<string, { value: string; expiresAt: number }>();

/**
 * Runtime business context with a 60s cache. Used by the chat engine to inject
 * FRESH business facts each turn instead of relying on the snapshot baked into
 * the stored system prompt (Issue #18).
 */
export async function getCachedBusinessContext(companyId: string): Promise<string> {
  const now = Date.now();
  const hit = contextCache.get(companyId);
  if (hit && hit.expiresAt > now) return hit.value;
  const value = await loadCompactBusinessContext(companyId);
  contextCache.set(companyId, { value, expiresAt: now + CONTEXT_TTL_MS });
  return value;
}

export async function loadCompactBusinessContext(companyId: string, sb: SB = createSupabaseServiceClient()): Promise<string> {
  const [profileRes, locationsRes, hoursRes, servicesRes, policiesRes, faqsRes] = await Promise.all([
    sb.from('company_business_profiles').select('*').eq('company_id', companyId).maybeSingle(),
    sb
      .from('company_locations')
      .select('name,address_line1,address_line2,city,region,country,phone,google_maps_url,service_area,is_primary,timezone')
      .eq('company_id', companyId)
      .order('is_primary', { ascending: false })
      .limit(3),
    sb
      .from('company_business_hours')
      .select('day_of_week,is_closed,open_time,close_time,notes')
      .eq('company_id', companyId)
      .is('location_id', null)
      .order('day_of_week', { ascending: true }),
    sb
      .from('company_services')
      .select('name,category,description,price_from,price_to,currency,duration_minutes,booking_required,requirements')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(8),
    sb
      .from('company_policies')
      .select('title,category')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(8),
    sb
      .from('company_faqs')
      .select('question,answer')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(5),
  ]);

  const profile = (profileRes.data ?? {}) as Record<string, unknown>;
  const sections: string[] = [];

  const basics = [
    line('Description', profile.short_description),
    line('Industry', profile.industry),
    line('Target customers', profile.target_customers),
    line('Brand voice', profile.brand_voice),
    line('Why customers choose us', profile.unique_selling_points),
    line('Service areas', profile.service_areas),
    line('Payment methods', profile.payment_methods),
    line('Default currency', profile.default_currency),
  ].filter(Boolean);
  if (basics.length) sections.push(`Business facts\n${basics.join('\n')}`);

  const contact = [
    line('Phone', profile.primary_phone),
    line('WhatsApp', profile.whatsapp),
    line('Support email', profile.support_email),
    line('Sales email', profile.sales_email),
    line('Public address', profile.public_address),
  ].filter(Boolean);
  if (contact.length) sections.push(`Contact\n${contact.join('\n')}`);

  const locations = (locationsRes.data ?? [])
    .map((l) => {
      const r = l as Record<string, unknown>;
      const address = [r.address_line1, r.address_line2, r.city, r.region, r.country].map(text).filter(Boolean).join(', ');
      return [text(r.name), address, text(r.phone), text(r.service_area)].filter(Boolean).join(' - ');
    })
    .filter(Boolean);
  if (locations.length) sections.push(`Locations\n${locations.map((x) => `- ${x}`).join('\n')}`);

  const hours = (hoursRes.data ?? [])
    .map((h) => {
      const r = h as Record<string, unknown>;
      const day = weekday(Number(r.day_of_week ?? 0));
      if (r.is_closed) return `${day}: closed${text(r.notes) ? ` (${text(r.notes)})` : ''}`;
      const open = text(r.open_time).slice(0, 5);
      const close = text(r.close_time).slice(0, 5);
      return open && close ? `${day}: ${open}-${close}${text(r.notes) ? ` (${text(r.notes)})` : ''}` : '';
    })
    .filter(Boolean);
  if (hours.length) sections.push(`Business hours\n${hours.join('\n')}`);

  const services = (servicesRes.data ?? [])
    .map((s) => {
      const r = s as Record<string, unknown>;
      const bits = [
        text(r.category),
        truncate(text(r.description), 100),
        money(r.price_from, r.price_to, r.currency),
        r.duration_minutes ? `${r.duration_minutes} min` : '',
        r.booking_required ? 'booking required' : '',
        text(r.requirements) ? `requires: ${truncate(text(r.requirements), 80)}` : '',
      ].filter(Boolean);
      return `- ${text(r.name)}${bits.length ? ` (${bits.join('; ')})` : ''}`;
    })
    .filter((s) => s !== '- ');
  if (services.length) sections.push(`Services\n${services.join('\n')}`);

  const policies = (policiesRes.data ?? [])
    .map((p) => {
      const r = p as Record<string, unknown>;
      return `${text(r.title)}${text(r.category) ? ` (${text(r.category)})` : ''}`;
    })
    .filter(Boolean);
  if (policies.length) sections.push(`Available policy docs\n${policies.join(', ')}`);

  const faqs = (faqsRes.data ?? [])
    .map((f) => {
      const r = f as Record<string, unknown>;
      return `Q: ${truncate(text(r.question), 90)} A: ${truncate(text(r.answer), 140)}`;
    })
    .filter((s) => s !== 'Q:  A: ');
  if (faqs.length) sections.push(`Common FAQs\n${faqs.join('\n')}`);

  const rules = [
    line('Escalation rules', profile.escalation_rules),
    line('Lead qualification rules', profile.lead_qualification_rules),
    line('Appointment rules', profile.appointment_rules),
  ].filter(Boolean);
  if (rules.length) sections.push(`Operating rules\n${rules.join('\n')}`);

  return truncate(sections.join('\n\n'), MAX_CONTEXT_CHARS);
}
