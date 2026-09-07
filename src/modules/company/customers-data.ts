import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from './data';

/**
 * The Customers overview.
 *
 * The page used to stack three previews — leads, appointments, orders — one
 * under the other, and to do it it read up to 500 leads and 500 appointments in
 * order to display eight of each. A shop with real volume paid for a thousand
 * rows to look at twenty-four, and had to scroll past two tables to reach the
 * third.
 *
 * So: the counts are counted (head-only, no rows transferred), and only the
 * section the visitor is actually looking at fetches rows.
 */

export type CustomerTab = 'leads' | 'appointments' | 'orders';

export const CUSTOMER_TABS: ReadonlyArray<{ key: CustomerTab; label: string; href: string }> = [
  { key: 'leads', label: 'Enquiries', href: '/company/leads' },
  { key: 'appointments', label: 'Booking requests', href: '/company/appointments' },
  { key: 'orders', label: 'Orders', href: '/company/orders' },
];

export function normalizeCustomerTab(value: string | undefined): CustomerTab {
  return CUSTOMER_TABS.some((t) => t.key === value) ? (value as CustomerTab) : 'leads';
}

export interface CustomerCounts {
  leads: number;
  appointments: number;
  orders: number;
}

export interface OverviewLead {
  id: string;
  name: string;
  contact: string | null;
  need: string | null;
  status: string;
  createdAt: string;
  conversationId: string | null;
}

export interface OverviewAppointment {
  id: string;
  customerName: string;
  serviceType: string | null;
  preferredDate: string | null;
  preferredTime: string | null;
  status: string;
  createdAt: string;
}

export interface OverviewOrder {
  id: string;
  customerName: string;
  status: string | null;
  total: number;
  currency: string;
  createdAt: string;
  /** 'chat' when placed in conversation, 'store' when synced from Shopify/Woo. */
  origin: 'chat' | 'store';
}

export interface CustomerOverview {
  tab: CustomerTab;
  counts: CustomerCounts;
  leads: OverviewLead[];
  appointments: OverviewAppointment[];
  orders: OverviewOrder[];
}

/** Row count without transferring any rows. */
async function countRows(table: string, companyId: string): Promise<number> {
  const sb = createSupabaseServiceClient();
  const { count } = await sb
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId);
  return count ?? 0;
}

export async function getCustomerOverview(
  tab: CustomerTab,
  previewSize = 8,
): Promise<CustomerOverview> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();

  const [leadCount, appointmentCount, chatOrderCount, storeOrderCount] = await Promise.all([
    countRows('leads', companyId),
    countRows('appointments', companyId),
    countRows('chat_orders', companyId),
    countRows('synced_orders', companyId),
  ]);

  const overview: CustomerOverview = {
    tab,
    counts: {
      leads: leadCount,
      appointments: appointmentCount,
      orders: chatOrderCount + storeOrderCount,
    },
    leads: [],
    appointments: [],
    orders: [],
  };

  if (tab === 'leads') {
    const { data } = await sb
      .from('leads')
      .select('id,name,email,phone,enquiry_type,status,created_at,conversation_id')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(previewSize);
    overview.leads = ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({
      id: row.id as string,
      name: ((row.name as string) || '').trim() || 'Someone who left no name',
      contact: ((row.email as string) || (row.phone as string) || null) as string | null,
      need: (row.enquiry_type as string) ?? null,
      status: (row.status as string) ?? 'new',
      createdAt: row.created_at as string,
      conversationId: (row.conversation_id as string) ?? null,
    }));
  }

  if (tab === 'appointments') {
    const { data } = await sb
      .from('appointments')
      .select('id,customer_name,service_type,preferred_date,preferred_time,status,created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(previewSize);
    overview.appointments = ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({
      id: row.id as string,
      customerName: ((row.customer_name as string) || '').trim() || 'Customer',
      serviceType: (row.service_type as string) ?? null,
      preferredDate: (row.preferred_date as string) ?? null,
      preferredTime: (row.preferred_time as string) ?? null,
      status: (row.status as string) ?? 'requested',
      createdAt: row.created_at as string,
    }));
  }

  if (tab === 'orders') {
    // Two tables hold orders — one for chat, one synced from a store. Both are
    // read at the preview size and merged, so neither can crowd the other out.
    const [chatRes, storeRes] = await Promise.all([
      sb
        .from('chat_orders')
        .select('id,customer_name,status,total,currency,created_at')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(previewSize),
      sb
        .from('synced_orders')
        .select('id,customer_name,status,total,currency,created_at')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(previewSize),
    ]);

    const map = (rows: unknown, origin: 'chat' | 'store'): OverviewOrder[] =>
      ((rows ?? []) as Array<Record<string, unknown>>).map((row) => ({
        id: row.id as string,
        customerName: ((row.customer_name as string) || '').trim() || 'Customer',
        status: (row.status as string) ?? null,
        total: Number(row.total ?? 0),
        currency: (row.currency as string) || 'GBP',
        createdAt: row.created_at as string,
        origin,
      }));

    overview.orders = [...map(chatRes.data, 'chat'), ...map(storeRes.data, 'store')]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, previewSize);
  }

  return overview;
}
