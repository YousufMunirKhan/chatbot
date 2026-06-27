import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { listErrorLogs, type ErrorLogSeverity, type ErrorLogStatus } from '@/modules/super-admin/data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const severities = ['all', 'info', 'warning', 'error', 'critical'] as const;
const statuses = ['open', 'all', 'resolved'] as const;

function cleanStatus(value: string | null): ErrorLogStatus {
  return statuses.includes(value as ErrorLogStatus) ? (value as ErrorLogStatus) : 'open';
}

function cleanSeverity(value: string | null): ErrorLogSeverity | 'all' {
  return severities.includes(value as ErrorLogSeverity | 'all') ? (value as ErrorLogSeverity | 'all') : 'all';
}

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET(req: Request) {
  await requireRole([ROLES.SUPER_ADMIN]);
  const url = new URL(req.url);
  const rows = await listErrorLogs({
    companyId: url.searchParams.get('companyId') || undefined,
    severity: cleanSeverity(url.searchParams.get('severity')),
    source: url.searchParams.get('source') || undefined,
    status: cleanStatus(url.searchParams.get('status')),
    q: url.searchParams.get('q') || undefined,
    limit: 1000,
  });
  const header = [
    'created_at',
    'severity',
    'source',
    'company',
    'user',
    'bot',
    'conversation_id',
    'route',
    'status_code',
    'message',
    'fingerprint',
    'resolved_at',
    'resolved_by',
  ];
  const csv = [
    header.map(csvCell).join(','),
    ...rows.map((row) =>
      [
        row.createdAt,
        row.severity,
        row.source,
        row.companyName,
        row.userEmail,
        row.botName,
        row.conversationId,
        row.route,
        row.statusCode,
        row.message,
        row.fingerprint,
        row.resolvedAt,
        row.resolvedByEmail,
      ].map(csvCell).join(','),
    ),
  ].join('\n');

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="error-logs-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
