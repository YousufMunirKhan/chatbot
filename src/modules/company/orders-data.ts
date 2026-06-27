import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from './data';

/**
 * Orders data layer (Modules 17–18). Both queries are scoped to the session
 * user's own company via `getCompanyId()` — never a request value.
 */

const countOf = (v: unknown): number => {
  if (Array.isArray(v)) return (v[0] as { count?: number })?.count ?? 0;
  return (v as { count?: number })?.count ?? 0;
};

export interface ChatOrderRow {
  id: string;
  orderType: string;
  status: string;
  customerName: string | null;
  total: number;
  currency: string;
  itemCount: number;
  createdAt: string;
}

export async function listChatOrders(): Promise<ChatOrderRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('chat_orders')
    .select(
      'id, order_type, status, customer_name, total, currency, created_at, chat_order_items(count)',
    )
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  if (error) throw error;

  return (data ?? []).map((o) => {
    const r = o as Record<string, unknown>;
    return {
      id: r.id as string,
      orderType: r.order_type as string,
      status: r.status as string,
      customerName: (r.customer_name as string) ?? null,
      total: Number(r.total ?? 0),
      currency: (r.currency as string) ?? 'USD',
      itemCount: countOf(r.chat_order_items),
      createdAt: r.created_at as string,
    };
  });
}

export interface SyncedOrderRow {
  id: string;
  orderNumber: string | null;
  customerName: string | null;
  status: string | null;
  total: number;
  currency: string;
  createdAt: string;
}

export async function listSyncedOrders(): Promise<SyncedOrderRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('synced_orders')
    .select('id, order_number, customer_name, status, total, currency, placed_at, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  if (error) throw error;

  return (data ?? []).map((o) => {
    const r = o as Record<string, unknown>;
    return {
      id: r.id as string,
      orderNumber: (r.order_number as string) ?? null,
      customerName: (r.customer_name as string) ?? null,
      status: (r.status as string) ?? null,
      total: Number(r.total ?? 0),
      currency: (r.currency as string) ?? 'USD',
      createdAt: (r.created_at as string) ?? (r.placed_at as string),
    };
  });
}
