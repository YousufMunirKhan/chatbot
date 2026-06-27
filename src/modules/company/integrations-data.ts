import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from './data';

/**
 * Integrations & Sync data layer (Module 14) and Catalog read models (Module 15).
 * Every query is scoped to the SESSION user's own `companyId` via {@link getCompanyId}.
 */

export interface IntegrationRow {
  id: string;
  provider: string;
  name: string;
  status: string;
  lastSyncAt: string | null;
}

export async function listIntegrations(): Promise<IntegrationRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('integration_accounts')
    .select('id, provider, name, status, last_sync_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => {
    const x = r as Record<string, unknown>;
    return {
      id: x.id as string,
      provider: x.provider as string,
      name: x.name as string,
      status: x.status as string,
      lastSyncAt: (x.last_sync_at as string) ?? null,
    };
  });
}

export interface SyncJobRow {
  id: string;
  status: string;
  recordsProcessed: number;
  errorMessage: string | null;
  createdAt: string;
}

export async function listSyncJobs(): Promise<SyncJobRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('sync_jobs')
    .select('id, status, records_processed, error_message, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? []).map((r) => {
    const x = r as Record<string, unknown>;
    return {
      id: x.id as string,
      status: x.status as string,
      recordsProcessed: (x.records_processed as number) ?? 0,
      errorMessage: (x.error_message as string) ?? null,
      createdAt: x.created_at as string,
    };
  });
}

export interface CatalogCounts {
  products: number;
  orders: number;
  customers: number;
  menuItems: number;
}

export async function catalogCounts(): Promise<CatalogCounts> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const countFor = async (table: string): Promise<number> => {
    const { count } = await sb
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId);
    return count ?? 0;
  };
  const [products, orders, customers, menuItems] = await Promise.all([
    countFor('synced_products'),
    countFor('synced_orders'),
    countFor('synced_customers'),
    countFor('restaurant_menu_items'),
  ]);
  return { products, orders, customers, menuItems };
}

export interface SyncedProductRow {
  id: string;
  title: string;
  price: number | null;
  currency: string | null;
  sku: string | null;
  status: string | null;
}

export async function listSyncedProducts(): Promise<SyncedProductRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('synced_products')
    .select('id, title, price, currency, sku, status')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []).map((r) => {
    const x = r as Record<string, unknown>;
    return {
      id: x.id as string,
      title: x.title as string,
      price: (x.price as number) ?? null,
      currency: (x.currency as string) ?? null,
      sku: (x.sku as string) ?? null,
      status: (x.status as string) ?? null,
    };
  });
}

export interface MenuItemRow {
  id: string;
  name: string;
  category: string | null;
  basePrice: number | null;
  isAvailable: boolean;
}

export async function listMenuItems(): Promise<MenuItemRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('restaurant_menu_items')
    .select('id, name, category, base_price, is_available')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []).map((r) => {
    const x = r as Record<string, unknown>;
    return {
      id: x.id as string,
      name: x.name as string,
      category: (x.category as string) ?? null,
      basePrice: (x.base_price as number) ?? null,
      isAvailable: Boolean(x.is_available),
    };
  });
}
