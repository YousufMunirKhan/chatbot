import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from './data';

/**
 * Leads data layer (Module 12). Every query is bound to the SESSION user's own
 * `companyId` so company admins and agents can only read their own company's
 * leads. Uses the service-role client (bypasses RLS) — tenant scoping enforced
 * in code.
 */

export interface LeadRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  enquiryType: string | null;
  message: string | null;
  status: string;
  createdAt: string;
  /** The chat this enquiry came from, so the reply can start with context. */
  conversationId: string | null;
  /** 'chat', 'manual', a flow id — where the enquiry entered the business. */
  source: string | null;
}

function toLeadRow(row: Record<string, unknown>): LeadRow {
  return {
    id: row.id as string,
    name: (row.name as string) ?? '',
    email: (row.email as string) ?? null,
    phone: (row.phone as string) ?? null,
    enquiryType: (row.enquiry_type as string) ?? null,
    message: (row.message as string) ?? null,
    status: row.status as string,
    createdAt: row.created_at as string,
    conversationId: (row.conversation_id as string) ?? null,
    source: (row.source as string) ?? null,
  };
}

export async function listLeads(): Promise<LeadRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('leads')
    .select('id,name,email,phone,enquiry_type,message,status,created_at,conversation_id,source')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []).map((row) => toLeadRow(row as Record<string, unknown>));
}

export interface ListLeadsOptions {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
}

export interface PagedLeads {
  rows: LeadRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

/** Paginated + searchable + status-filtered leads for the leads dashboard. */
export async function listLeadsPaged(opts: ListLeadsOptions = {}): Promise<PagedLeads> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const pageSize = Math.min(100, Math.max(5, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = sb
    .from('leads')
    .select('id,name,email,phone,enquiry_type,message,status,created_at,conversation_id,source', { count: 'exact' })
    .eq('company_id', companyId);

  if (opts.status && opts.status !== 'all') query = query.eq('status', opts.status);

  const search = opts.search?.trim();
  if (search) {
    const safe = search.replace(/[%,()]/g, ' ');
    query = query.or(`name.ilike.%${safe}%,email.ilike.%${safe}%,phone.ilike.%${safe}%`);
  }

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) throw error;

  const total = count ?? 0;
  return {
    rows: (data ?? []).map((row) => toLeadRow(row as Record<string, unknown>)),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}
