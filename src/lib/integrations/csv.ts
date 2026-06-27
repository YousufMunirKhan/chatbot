import { createSupabaseServiceClient } from '@/lib/db/server';

/** Minimal CSV parser (handles quoted fields + commas/newlines in quotes). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (field !== '' || row.length) {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      }
      if (c === '\r' && text[i + 1] === '\n') i++;
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length === 0) return [];
  const headers = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => (obj[h] = (r[idx] ?? '').trim()));
    return obj;
  });
}

export type CsvEntity = 'products' | 'orders' | 'customers' | 'inventory' | 'menu';

const pick = (row: Record<string, string>, keys: string[]): string => {
  for (const k of keys) if (row[k]) return row[k];
  return '';
};
const numOrNull = (v: string): number | null => (v && !Number.isNaN(Number(v)) ? Number(v) : null);

/** Import a CSV into the structured tables (Module 14/15). Returns rows imported. */
export async function importCsv(
  companyId: string,
  entity: CsvEntity,
  csvText: string,
): Promise<number> {
  const rows = parseCsv(csvText);
  if (rows.length === 0) return 0;
  const sb = createSupabaseServiceClient();

  if (entity === 'products') {
    const payload = rows.map((r) => ({
      company_id: companyId,
      external_id: pick(r, ['id', 'external_id', 'sku']) || null,
      title: pick(r, ['title', 'name', 'product']) || 'Untitled',
      description: pick(r, ['description', 'desc']) || null,
      category: pick(r, ['category', 'type']) || null,
      price: numOrNull(pick(r, ['price', 'amount'])),
      currency: pick(r, ['currency']) || 'USD',
      sku: pick(r, ['sku', 'code']) || null,
      status: 'active',
    }));
    const { error } = await sb.from('synced_products').insert(payload);
    if (error) throw error;
    return payload.length;
  }

  if (entity === 'menu') {
    const payload = rows.map((r) => ({
      company_id: companyId,
      name: pick(r, ['name', 'item', 'title']) || 'Untitled',
      description: pick(r, ['description', 'desc']) || null,
      category: pick(r, ['category', 'section']) || null,
      base_price: numOrNull(pick(r, ['price', 'base_price'])),
      currency: pick(r, ['currency']) || 'USD',
      is_available: (pick(r, ['available', 'is_available']) || 'true').toLowerCase() !== 'false',
      allergy_notes: pick(r, ['allergens', 'allergy_notes']) || null,
    }));
    const { error } = await sb.from('restaurant_menu_items').insert(payload);
    if (error) throw error;
    return payload.length;
  }

  if (entity === 'customers') {
    const payload = rows.map((r) => ({
      company_id: companyId,
      external_id: pick(r, ['id', 'external_id']) || null,
      name: pick(r, ['name', 'customer']) || null,
      email: pick(r, ['email']) || null,
      phone: pick(r, ['phone', 'mobile']) || null,
    }));
    const { error } = await sb.from('synced_customers').insert(payload);
    if (error) throw error;
    return payload.length;
  }

  if (entity === 'orders') {
    const payload = rows.map((r) => ({
      company_id: companyId,
      external_id: pick(r, ['id', 'external_id']) || null,
      order_number: pick(r, ['order_number', 'order', 'number']) || null,
      customer_name: pick(r, ['customer_name', 'name']) || null,
      customer_email: pick(r, ['email']) || null,
      customer_phone: pick(r, ['phone']) || null,
      status: pick(r, ['status']) || null,
      fulfillment_status: pick(r, ['fulfillment_status', 'fulfillment']) || null,
      tracking_number: pick(r, ['tracking_number', 'tracking']) || null,
      tracking_url: pick(r, ['tracking_url']) || null,
      total: numOrNull(pick(r, ['total', 'amount'])),
      currency: pick(r, ['currency']) || 'USD',
    }));
    const { error } = await sb.from('synced_orders').insert(payload);
    if (error) throw error;
    return payload.length;
  }

  // inventory
  const { data: products } = await sb
    .from('synced_products')
    .select('id,external_id,sku,title')
    .eq('company_id', companyId);
  const productByKey = new Map<string, string>();
  for (const product of products ?? []) {
    const p = product as Record<string, string | null>;
    for (const value of [p.id, p.external_id, p.sku, p.title]) {
      if (value) productByKey.set(value.trim().toLowerCase(), p.id as string);
    }
  }
  const payload = rows.map((r) => ({
    company_id: companyId,
    product_id:
      productByKey.get(
        pick(r, ['product_id', 'product_external_id', 'external_id', 'sku', 'product', 'title', 'name']).toLowerCase(),
      ) ?? null,
    quantity: numOrNull(pick(r, ['quantity', 'qty', 'stock'])) ?? 0,
    in_stock: (numOrNull(pick(r, ['quantity', 'qty', 'stock'])) ?? 0) > 0,
    location: pick(r, ['location', 'warehouse']) || null,
  }));
  const { error } = await sb.from('synced_inventory').insert(payload);
  if (error) throw error;
  return payload.length;
}
