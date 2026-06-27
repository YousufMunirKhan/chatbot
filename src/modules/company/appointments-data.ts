import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from './data';

/**
 * Appointments data layer (Module 13). Every query is bound to the SESSION
 * user's own `companyId` so company admins and agents can only read their own
 * company's appointment requests.
 */

export interface AppointmentRow {
  id: string;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  serviceType: string | null;
  preferredDate: string | null;
  preferredTime: string | null;
  notes: string | null;
  status: string;
  createdAt: string;
}

function toAppointmentRow(a: Record<string, unknown>): AppointmentRow {
  return {
    id: a.id as string,
    customerName: (a.customer_name as string) ?? '',
    customerPhone: (a.customer_phone as string) ?? null,
    customerEmail: (a.customer_email as string) ?? null,
    serviceType: (a.service_type as string) ?? null,
    preferredDate: (a.preferred_date as string) ?? null,
    preferredTime: (a.preferred_time as string) ?? null,
    notes: (a.notes as string) ?? null,
    status: a.status as string,
    createdAt: a.created_at as string,
  };
}

export async function listAppointments(): Promise<AppointmentRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('appointments')
    .select(
      'id,customer_name,customer_phone,customer_email,service_type,preferred_date,preferred_time,notes,status,created_at',
    )
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []).map((row) => toAppointmentRow(row as Record<string, unknown>));
}

export interface ListAppointmentsOptions {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
}

export interface PagedAppointments {
  rows: AppointmentRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

/** Paginated + searchable + status-filtered appointments for the dashboard. */
export async function listAppointmentsPaged(
  opts: ListAppointmentsOptions = {},
): Promise<PagedAppointments> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const pageSize = Math.min(100, Math.max(5, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = sb
    .from('appointments')
    .select(
      'id,customer_name,customer_phone,customer_email,service_type,preferred_date,preferred_time,notes,status,created_at',
      { count: 'exact' },
    )
    .eq('company_id', companyId);

  if (opts.status && opts.status !== 'all') query = query.eq('status', opts.status);

  const search = opts.search?.trim();
  if (search) {
    const safe = search.replace(/[%,()]/g, ' ');
    query = query.or(
      `customer_name.ilike.%${safe}%,customer_email.ilike.%${safe}%,customer_phone.ilike.%${safe}%`,
    );
  }

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) throw error;

  const total = count ?? 0;
  return {
    rows: (data ?? []).map((row) => toAppointmentRow(row as Record<string, unknown>)),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}
