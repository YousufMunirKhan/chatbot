import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from './data';

const rec = (v: unknown): Record<string, unknown> => (v ?? {}) as Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' || typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

export interface BusinessProfileMemory {
  shortDescription: string | null;
  industry: string | null;
  targetCustomers: string | null;
  brandVoice: string | null;
  answerLength: string;
  answerStrictness: string;
  salesStyle: string;
  toneNotes: string | null;
  bannedPhrases: string[];
  escalationMessage: string | null;
  uniqueSellingPoints: string | null;
  primaryPhone: string | null;
  supportEmail: string | null;
  salesEmail: string | null;
  whatsapp: string | null;
  publicAddress: string | null;
  serviceAreas: string | null;
  defaultCurrency: string;
  paymentMethods: string[];
  escalationRules: string | null;
  leadQualificationRules: string | null;
  appointmentRules: string | null;
}

export interface LocationRow {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  timezone: string | null;
  serviceArea: string | null;
  isPrimary: boolean;
}

export interface HoursRow {
  dayOfWeek: number;
  isClosed: boolean;
  openTime: string | null;
  closeTime: string | null;
  notes: string | null;
}

export interface PolicyRow {
  id: string;
  title: string;
  category: string;
  content: string;
  createdAt: string;
}

export interface ServiceRow {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  priceFrom: number | null;
  priceTo: number | null;
  currency: string;
  durationMinutes: number | null;
  bookingRequired: boolean;
  requirements: string | null;
}

export interface FaqRow {
  id: string;
  question: string;
  answer: string;
  category: string | null;
}

export interface BusinessReadinessItem {
  key: string;
  label: string;
  complete: boolean;
}

export interface BusinessMemoryData {
  profile: BusinessProfileMemory;
  locations: LocationRow[];
  hours: HoursRow[];
  policies: PolicyRow[];
  services: ServiceRow[];
  faqs: FaqRow[];
  readiness: {
    complete: number;
    total: number;
    percent: number;
    items: BusinessReadinessItem[];
  };
}

const EMPTY_PROFILE: BusinessProfileMemory = {
  shortDescription: null,
  industry: null,
  targetCustomers: null,
  brandVoice: null,
  answerLength: 'balanced',
  answerStrictness: 'grounded',
  salesStyle: 'helpful',
  toneNotes: null,
  bannedPhrases: [],
  escalationMessage: null,
  uniqueSellingPoints: null,
  primaryPhone: null,
  supportEmail: null,
  salesEmail: null,
  whatsapp: null,
  publicAddress: null,
  serviceAreas: null,
  defaultCurrency: 'USD',
  paymentMethods: [],
  escalationRules: null,
  leadQualificationRules: null,
  appointmentRules: null,
};

export async function getBusinessMemory(): Promise<BusinessMemoryData> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();

  const [profileRes, locationsRes, hoursRes, policiesRes, servicesRes, faqsRes] = await Promise.all([
    sb.from('company_business_profiles').select('*').eq('company_id', companyId).maybeSingle(),
    sb.from('company_locations').select('*').eq('company_id', companyId).order('is_primary', { ascending: false }),
    sb
      .from('company_business_hours')
      .select('*')
      .eq('company_id', companyId)
      .is('location_id', null)
      .order('day_of_week', { ascending: true }),
    sb
      .from('company_policies')
      .select('id,title,category,content,created_at')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('created_at', { ascending: false }),
    sb
      .from('company_services')
      .select('*')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('created_at', { ascending: false }),
    sb
      .from('company_faqs')
      .select('id,question,answer,category')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('created_at', { ascending: false }),
  ]);

  const p = rec(profileRes.data);
  const profile: BusinessProfileMemory = profileRes.data
    ? {
        shortDescription: str(p.short_description),
        industry: str(p.industry),
        targetCustomers: str(p.target_customers),
        brandVoice: str(p.brand_voice),
        answerLength: str(p.answer_length) ?? 'balanced',
        answerStrictness: str(p.answer_strictness) ?? 'grounded',
        salesStyle: str(p.sales_style) ?? 'helpful',
        toneNotes: str(p.tone_notes),
        bannedPhrases: Array.isArray(p.banned_phrases) ? p.banned_phrases.map(String) : [],
        escalationMessage: str(p.escalation_message),
        uniqueSellingPoints: str(p.unique_selling_points),
        primaryPhone: str(p.primary_phone),
        supportEmail: str(p.support_email),
        salesEmail: str(p.sales_email),
        whatsapp: str(p.whatsapp),
        publicAddress: str(p.public_address),
        serviceAreas: str(p.service_areas),
        defaultCurrency: str(p.default_currency) ?? 'USD',
        paymentMethods: Array.isArray(p.payment_methods) ? p.payment_methods.map(String) : [],
        escalationRules: str(p.escalation_rules),
        leadQualificationRules: str(p.lead_qualification_rules),
        appointmentRules: str(p.appointment_rules),
      }
    : EMPTY_PROFILE;

  const locations = (locationsRes.data ?? []).map((row) => {
    const x = row as Record<string, unknown>;
    const address = [x.address_line1, x.address_line2].map(str).filter(Boolean).join(', ');
    return {
      id: x.id as string,
      name: (str(x.name) ?? 'Location') as string,
      address: address || null,
      city: str(x.city),
      country: str(x.country),
      phone: str(x.phone),
      timezone: str(x.timezone),
      serviceArea: str(x.service_area),
      isPrimary: Boolean(x.is_primary),
    };
  });

  const existingHours = new Map(
    (hoursRes.data ?? []).map((h) => {
      const x = h as Record<string, unknown>;
      return [Number(x.day_of_week), x] as const;
    }),
  );
  const hours: HoursRow[] = Array.from({ length: 7 }, (_, dayOfWeek) => {
    const x = existingHours.get(dayOfWeek);
    return {
      dayOfWeek,
      isClosed: Boolean(x?.is_closed),
      openTime: str(x?.open_time)?.slice(0, 5) ?? null,
      closeTime: str(x?.close_time)?.slice(0, 5) ?? null,
      notes: str(x?.notes),
    };
  });

  const policies = (policiesRes.data ?? []).map((row) => {
    const x = row as Record<string, unknown>;
    return {
      id: x.id as string,
      title: (str(x.title) ?? 'Policy') as string,
      category: (str(x.category) ?? 'general') as string,
      content: (str(x.content) ?? '') as string,
      createdAt: x.created_at as string,
    };
  });

  const services = (servicesRes.data ?? []).map((row) => {
    const x = row as Record<string, unknown>;
    return {
      id: x.id as string,
      name: (str(x.name) ?? 'Service') as string,
      category: str(x.category),
      description: str(x.description),
      priceFrom: num(x.price_from),
      priceTo: num(x.price_to),
      currency: str(x.currency) ?? profile.defaultCurrency,
      durationMinutes: num(x.duration_minutes),
      bookingRequired: Boolean(x.booking_required),
      requirements: str(x.requirements),
    };
  });

  const faqs = (faqsRes.data ?? []).map((row) => {
    const x = row as Record<string, unknown>;
    return {
      id: x.id as string,
      question: (str(x.question) ?? '') as string,
      answer: (str(x.answer) ?? '') as string,
      category: str(x.category),
    };
  });

  const items: BusinessReadinessItem[] = [
    { key: 'description', label: 'Business description', complete: Boolean(profile.shortDescription) },
    { key: 'industry', label: 'Industry', complete: Boolean(profile.industry) },
    { key: 'contact', label: 'Phone, email, or WhatsApp', complete: Boolean(profile.primaryPhone || profile.supportEmail || profile.whatsapp) },
    { key: 'location', label: 'Location or service area', complete: Boolean(locations.length || profile.publicAddress || profile.serviceAreas) },
    { key: 'hours', label: 'Business hours', complete: hours.some((h) => h.isClosed || (h.openTime && h.closeTime)) },
    { key: 'services', label: 'Services or offers', complete: services.length > 0 },
    { key: 'policies', label: 'Policies', complete: policies.length > 0 },
    { key: 'faqs', label: 'FAQs', complete: faqs.length > 0 },
    { key: 'handoff', label: 'Escalation rules', complete: Boolean(profile.escalationRules) },
    { key: 'qualification', label: 'Lead or appointment rules', complete: Boolean(profile.leadQualificationRules || profile.appointmentRules) },
  ];
  const complete = items.filter((i) => i.complete).length;

  return {
    profile,
    locations,
    hours,
    policies,
    services,
    faqs,
    readiness: {
      complete,
      total: items.length,
      percent: Math.round((complete / items.length) * 100),
      items,
    },
  };
}
