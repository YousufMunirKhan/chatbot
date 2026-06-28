'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { ingestText } from '@/lib/ai/ingest';
import { getCompanyId } from './data';
import { recomputeCompanyBotPrompts } from './prompt';
import {
  FAQ_CATEGORY_VALUES,
  POLICY_CATEGORY_VALUES,
  SERVICE_CATEGORY_VALUES,
} from './business-categories';

export type ActionState = { error?: string; ok?: boolean };

const optText = z.preprocess((x) => (x === '' || x == null ? undefined : x), z.string().optional());
const optEmail = z.preprocess((x) => (x === '' || x == null ? undefined : x), z.string().email().optional());
const optNumber = z.preprocess(
  (x) => (x === '' || x == null ? undefined : x),
  z.coerce.number().nonnegative().optional(),
);

function csvToArray(v: FormDataEntryValue | null): string[] {
  if (typeof v !== 'string') return [];
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12);
}

async function refresh(companyId: string) {
  const sb = createSupabaseServiceClient();
  await recomputeCompanyBotPrompts(sb, companyId);
  revalidatePath('/company/profile');
  revalidatePath('/company/business-data');
  revalidatePath('/company/setup');
  revalidatePath('/company');
  revalidatePath('/company/bots');
}

const businessProfileSchema = z.object({
  shortDescription: optText,
  industry: optText,
  targetCustomers: optText,
  brandVoice: optText,
  answerLength: z.enum(['short', 'balanced', 'detailed']).default('balanced'),
  answerStrictness: z.enum(['strict', 'grounded', 'flexible']).default('grounded'),
  salesStyle: z.enum(['support_only', 'helpful', 'sales_focused']).default('helpful'),
  toneNotes: optText,
  escalationMessage: optText,
  uniqueSellingPoints: optText,
  primaryPhone: optText,
  supportEmail: optEmail,
  salesEmail: optEmail,
  whatsapp: optText,
  publicAddress: optText,
  serviceAreas: optText,
  defaultCurrency: z.string().min(3).max(3).default('USD'),
  escalationRules: optText,
  leadQualificationRules: optText,
  appointmentRules: optText,
});

export async function updateBusinessMemoryAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = businessProfileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const v = parsed.data;
  const sb = createSupabaseServiceClient();

  const { error } = await sb.from('company_business_profiles').upsert(
    {
      company_id: companyId,
      short_description: v.shortDescription ?? null,
      industry: v.industry ?? null,
      target_customers: v.targetCustomers ?? null,
      brand_voice: v.brandVoice ?? null,
      answer_length: v.answerLength,
      answer_strictness: v.answerStrictness,
      sales_style: v.salesStyle,
      tone_notes: v.toneNotes ?? null,
      banned_phrases: csvToArray(formData.get('bannedPhrases')),
      escalation_message: v.escalationMessage ?? null,
      unique_selling_points: v.uniqueSellingPoints ?? null,
      primary_phone: v.primaryPhone ?? null,
      support_email: v.supportEmail ?? null,
      sales_email: v.salesEmail ?? null,
      whatsapp: v.whatsapp ?? null,
      public_address: v.publicAddress ?? null,
      service_areas: v.serviceAreas ?? null,
      default_currency: v.defaultCurrency.toUpperCase(),
      payment_methods: csvToArray(formData.get('paymentMethods')),
      escalation_rules: v.escalationRules ?? null,
      lead_qualification_rules: v.leadQualificationRules ?? null,
      appointment_rules: v.appointmentRules ?? null,
      updated_by: admin.userId,
    },
    { onConflict: 'company_id' },
  );
  if (error) return { error: error.message };
  await refresh(companyId);
  return { ok: true };
}

const locationSchema = z.object({
  name: z.string().min(2, 'Location name is required'),
  addressLine1: optText,
  addressLine2: optText,
  city: optText,
  region: optText,
  country: optText,
  postalCode: optText,
  timezone: optText,
  phone: optText,
  googleMapsUrl: z.preprocess((x) => (x === '' ? undefined : x), z.string().url().optional()),
  serviceArea: optText,
});

export async function addLocationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = locationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const v = parsed.data;
  const sb = createSupabaseServiceClient();

  const { count } = await sb
    .from('company_locations')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId);

  const { error } = await sb.from('company_locations').insert({
    company_id: companyId,
    name: v.name,
    address_line1: v.addressLine1 ?? null,
    address_line2: v.addressLine2 ?? null,
    city: v.city ?? null,
    region: v.region ?? null,
    country: v.country ?? null,
    postal_code: v.postalCode ?? null,
    timezone: v.timezone ?? null,
    phone: v.phone ?? null,
    google_maps_url: v.googleMapsUrl ?? null,
    service_area: v.serviceArea ?? null,
    is_primary: (count ?? 0) === 0,
  });
  if (error) return { error: error.message };
  await refresh(companyId);
  return { ok: true };
}

const idSchema = z.object({ id: z.string().uuid() });

export async function deleteLocationAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = idSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const sb = createSupabaseServiceClient();
  await sb.from('company_locations').delete().eq('company_id', companyId).eq('id', parsed.data.id);
  await refresh(companyId);
}

function cleanTime(v: FormDataEntryValue | null): string | null {
  if (typeof v !== 'string' || !/^\d{2}:\d{2}$/.test(v)) return null;
  return v;
}

export async function updateHoursAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();

  const rows = Array.from({ length: 7 }, (_, day) => {
    const isClosed = formData.get(`closed_${day}`) === 'on';
    const openTime = isClosed ? null : cleanTime(formData.get(`open_${day}`));
    const closeTime = isClosed ? null : cleanTime(formData.get(`close_${day}`));
    return {
      company_id: companyId,
      location_id: null,
      day_of_week: day,
      is_closed: isClosed,
      open_time: openTime,
      close_time: closeTime,
      notes: typeof formData.get(`notes_${day}`) === 'string' ? String(formData.get(`notes_${day}`)).trim() || null : null,
    };
  });

  await sb.from('company_business_hours').delete().eq('company_id', companyId).is('location_id', null);
  const { error } = await sb.from('company_business_hours').insert(rows);
  if (error) return { error: error.message };
  await refresh(companyId);
  return { ok: true };
}

const serviceSchema = z.object({
  name: z.string().min(2, 'Service name is required'),
  category: z.enum(SERVICE_CATEGORY_VALUES as [string, ...string[]]).default('service'),
  description: optText,
  priceFrom: optNumber,
  priceTo: optNumber,
  currency: z.string().min(3).max(3).default('USD'),
  durationMinutes: z.preprocess((x) => (x === '' || x == null ? undefined : x), z.coerce.number().int().positive().optional()),
  requirements: optText,
});

export async function addServiceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = serviceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const v = parsed.data;
  const sb = createSupabaseServiceClient();
  const { error } = await sb.from('company_services').insert({
    company_id: companyId,
    name: v.name,
    category: v.category ?? null,
    description: v.description ?? null,
    price_from: v.priceFrom ?? null,
    price_to: v.priceTo ?? null,
    currency: v.currency.toUpperCase(),
    duration_minutes: v.durationMinutes ?? null,
    booking_required: formData.get('bookingRequired') === 'on',
    requirements: v.requirements ?? null,
  });
  if (error) return { error: error.message };
  await refresh(companyId);
  return { ok: true };
}

const updateServiceSchema = serviceSchema.extend({
  id: z.string().uuid(),
});

export async function updateServiceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = updateServiceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const v = parsed.data;
  const sb = createSupabaseServiceClient();
  const { error } = await sb
    .from('company_services')
    .update({
      name: v.name,
      category: v.category ?? null,
      description: v.description ?? null,
      price_from: v.priceFrom ?? null,
      price_to: v.priceTo ?? null,
      currency: v.currency.toUpperCase(),
      duration_minutes: v.durationMinutes ?? null,
      booking_required: formData.get('bookingRequired') === 'on',
      requirements: v.requirements ?? null,
    })
    .eq('company_id', companyId)
    .eq('id', v.id);
  if (error) return { error: error.message };
  await refresh(companyId);
  return { ok: true };
}

export async function deleteServiceAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = idSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const sb = createSupabaseServiceClient();
  await sb.from('company_services').update({ is_active: false }).eq('company_id', companyId).eq('id', parsed.data.id);
  await refresh(companyId);
}

const policySchema = z.object({
  title: z.string().min(2, 'Policy title is required'),
  category: z.enum(POLICY_CATEGORY_VALUES as [string, ...string[]]).default('general'),
  content: z.string().min(20, 'Policy needs at least 20 characters').max(50000),
});

export async function addPolicyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = policySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const v = parsed.data;
  const sb = createSupabaseServiceClient();

  let documentId: string | null = null;
  try {
    const doc = await ingestText({
      companyId,
      botId: null,
      title: `Policy: ${v.title}`,
      text: `${v.title}\nCategory: ${v.category}\n\n${v.content}`,
      sourceType: 'text',
    });
    documentId = doc.documentId;
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not index policy' };
  }

  const { error } = await sb.from('company_policies').insert({
    company_id: companyId,
    title: v.title,
    category: v.category,
    content: v.content,
    document_id: documentId,
  });
  if (error) return { error: error.message };
  await refresh(companyId);
  revalidatePath('/company/knowledge');
  return { ok: true };
}

const updatePolicySchema = policySchema.extend({
  id: z.string().uuid(),
});

export async function updatePolicyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = updatePolicySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const v = parsed.data;
  const sb = createSupabaseServiceClient();

  const { data: existing } = await sb
    .from('company_policies')
    .select('document_id')
    .eq('company_id', companyId)
    .eq('id', v.id)
    .maybeSingle();

  let documentId: string | null = null;
  try {
    const doc = await ingestText({
      companyId,
      botId: null,
      title: `Policy: ${v.title}`,
      text: `${v.title}\nCategory: ${v.category}\n\n${v.content}`,
      sourceType: 'text',
    });
    documentId = doc.documentId;
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not re-index policy' };
  }

  const { error } = await sb
    .from('company_policies')
    .update({
      title: v.title,
      category: v.category,
      content: v.content,
      document_id: documentId,
    })
    .eq('company_id', companyId)
    .eq('id', v.id);
  if (error) return { error: error.message };
  const oldDocumentId = (existing as { document_id?: string | null } | null)?.document_id;
  if (oldDocumentId && oldDocumentId !== documentId) {
    await sb.from('documents').delete().eq('company_id', companyId).eq('id', oldDocumentId);
  }
  await refresh(companyId);
  revalidatePath('/company/knowledge');
  return { ok: true };
}

export async function deletePolicyAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = idSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('company_policies')
    .select('document_id')
    .eq('company_id', companyId)
    .eq('id', parsed.data.id)
    .maybeSingle();
  await sb.from('company_policies').update({ is_active: false }).eq('company_id', companyId).eq('id', parsed.data.id);
  if ((data as { document_id?: string } | null)?.document_id) {
    await sb.from('documents').delete().eq('company_id', companyId).eq('id', (data as { document_id: string }).document_id);
  }
  await refresh(companyId);
  revalidatePath('/company/knowledge');
}

const faqSchema = z.object({
  question: z.string().min(3, 'Question is required').max(500),
  answer: z.string().min(3, 'Answer is required').max(5000),
  category: z.enum(FAQ_CATEGORY_VALUES as [string, ...string[]]).default('general'),
});

export async function addFaqAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = faqSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const v = parsed.data;
  const sb = createSupabaseServiceClient();

  let documentId: string | null = null;
  try {
    const doc = await ingestText({
      companyId,
      botId: null,
      title: `FAQ: ${v.question.slice(0, 80)}`,
      text: `Question: ${v.question}\nTopic: ${v.category}\nAnswer: ${v.answer}`,
      sourceType: 'faq',
    });
    documentId = doc.documentId;
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not index FAQ' };
  }

  const { error } = await sb.from('company_faqs').insert({
    company_id: companyId,
    question: v.question,
    answer: v.answer,
    category: v.category,
    document_id: documentId,
  });
  if (error) return { error: error.message };
  await refresh(companyId);
  revalidatePath('/company/knowledge');
  return { ok: true };
}

const updateFaqSchema = faqSchema.extend({
  id: z.string().uuid(),
});

export async function updateFaqAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = updateFaqSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const v = parsed.data;
  const sb = createSupabaseServiceClient();

  const { data: existing } = await sb
    .from('company_faqs')
    .select('document_id')
    .eq('company_id', companyId)
    .eq('id', v.id)
    .maybeSingle();

  let documentId: string | null = null;
  try {
    const doc = await ingestText({
      companyId,
      botId: null,
      title: `FAQ: ${v.question.slice(0, 80)}`,
      text: `Question: ${v.question}\nTopic: ${v.category}\nAnswer: ${v.answer}`,
      sourceType: 'faq',
    });
    documentId = doc.documentId;
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not re-index FAQ' };
  }

  const { error } = await sb
    .from('company_faqs')
    .update({
      question: v.question,
      answer: v.answer,
      category: v.category,
      document_id: documentId,
    })
    .eq('company_id', companyId)
    .eq('id', v.id);
  if (error) return { error: error.message };
  const oldDocumentId = (existing as { document_id?: string | null } | null)?.document_id;
  if (oldDocumentId && oldDocumentId !== documentId) {
    await sb.from('documents').delete().eq('company_id', companyId).eq('id', oldDocumentId);
  }
  await refresh(companyId);
  revalidatePath('/company/knowledge');
  return { ok: true };
}

export async function deleteFaqAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = idSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('company_faqs')
    .select('document_id')
    .eq('company_id', companyId)
    .eq('id', parsed.data.id)
    .maybeSingle();
  await sb.from('company_faqs').update({ is_active: false }).eq('company_id', companyId).eq('id', parsed.data.id);
  if ((data as { document_id?: string } | null)?.document_id) {
    await sb.from('documents').delete().eq('company_id', companyId).eq('id', (data as { document_id: string }).document_id);
  }
  await refresh(companyId);
  revalidatePath('/company/knowledge');
}
