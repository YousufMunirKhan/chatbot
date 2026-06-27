import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { getCompanyId } from '@/modules/company/data';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { handleApiError } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Escape a single CSV field — wrap in quotes and double internal quotes. */
function csvField(value: unknown): string {
  const s = value == null ? '' : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * Export own company leads as CSV (Module 12). Company-admin only; scoped to the
 * session user's company.
 */
export async function GET() {
  try {
    await requireRole([ROLES.COMPANY_ADMIN]);
    const companyId = await getCompanyId();
    const sb = createSupabaseServiceClient();

    const { data, error } = await sb
      .from('leads')
      .select('name,email,phone,enquiry_type,message,status,created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(5000);
    if (error) throw error;

    const header = ['name', 'email', 'phone', 'enquiry_type', 'message', 'status', 'created_at'];
    const lines = [header.map(csvField).join(',')];
    for (const row of data ?? []) {
      const l = row as Record<string, unknown>;
      lines.push(
        [
          csvField(l.name),
          csvField(l.email),
          csvField(l.phone),
          csvField(l.enquiry_type),
          csvField(l.message),
          csvField(l.status),
          csvField(l.created_at),
        ].join(','),
      );
    }
    const csv = lines.join('\r\n');

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="leads.csv"',
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
