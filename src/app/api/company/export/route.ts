import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { getCompanyId } from '@/modules/company/data';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { handleApiError } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Export own company data (Module 23: "export own data"). Company-admin only;
 * returns a JSON bundle of the company's records.
 */
export async function GET() {
  try {
    await requireRole([ROLES.COMPANY_ADMIN]);
    const companyId = await getCompanyId();
    const sb = createSupabaseServiceClient();

    const tables = ['companies', 'bots', 'leads', 'appointments', 'conversations', 'messages', 'synced_products', 'synced_orders', 'chat_orders'];
    const bundle: Record<string, unknown> = { exportedAt: new Date().toISOString(), companyId };
    for (const t of tables) {
      const col = t === 'companies' ? 'id' : 'company_id';
      const { data } = await sb.from(t).select('*').eq(col, companyId).limit(5000);
      bundle[t] = data ?? [];
    }

    return new NextResponse(JSON.stringify(bundle, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="company-export.json"`,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
