import { createSupabaseServiceClient } from '@/lib/db/server';
import { sendEmail } from '@/lib/email';
import { env } from '@/lib/env';
import { computeQualityRoom, type Suggestion } from '@/modules/company/suggestions-data';
import { getCompanyEvalDetail } from './quality-data';

/**
 * "How to make your assistant better" report — combines the answer-quality score
 * (graded eval) with the actionable suggestions engine (what to add, where, and
 * the impact). Surfaced on the super-admin Platform Quality page and emailed to
 * companies (on demand + weekly).
 */
export interface ImprovementReport {
  companyId: string;
  companyName: string;
  answerQuality: number | null;
  setupCompleted: number;
  setupTotal: number;
  /** Specific "add/update X in Y place" fixes from the latest graded eval. */
  specificFixes: Array<{ question: string; fix: string }>;
  /** Generic setup gaps from the suggestions engine. */
  fixes: Suggestion[];
}

const SECTION_LABEL: Record<string, string> = {
  '/company/profile': 'Business Profile',
  '/company/knowledge': 'Knowledge Base',
  '/company/integrations': 'Integrations',
  '/company/quality': 'Quality Room',
};
export function whereLabel(href: string): string {
  return SECTION_LABEL[href] ?? 'Settings';
}

export async function buildImprovementReport(companyId: string): Promise<ImprovementReport> {
  const sb = createSupabaseServiceClient();
  const [room, evalDetail, companyRow] = await Promise.all([
    computeQualityRoom(companyId),
    getCompanyEvalDetail(companyId),
    sb.from('companies').select('name').eq('id', companyId).maybeSingle(),
  ]);
  const specificFixes = (evalDetail?.results ?? [])
    .filter((r) => r.fix && r.verdict === 'fail')
    .map((r) => ({ question: r.question, fix: r.fix }));

  return {
    companyId,
    companyName: (companyRow.data?.name as string) ?? 'Company',
    answerQuality: evalDetail?.avgAnswerScore ?? null,
    setupCompleted: room.setupCompleted,
    setupTotal: room.setupTotal,
    specificFixes,
    fixes: room.suggestions,
  };
}

/**
 * Lightweight per-company list for the platform overview — eval score + the
 * specific fixes only (≈1 query/company). The full suggestions engine (≈10
 * queries) is NOT run here; it's built on demand by buildImprovementReport()
 * for the email and the single-company view. Keeps the page cheap at scale.
 */
export async function getPlatformImprovements(): Promise<ImprovementReport[]> {
  const sb = createSupabaseServiceClient();
  const { data: companies } = await sb
    .from('companies')
    .select('id, name')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(15);
  const reports = await Promise.all(
    (companies ?? []).map(async (c) => {
      const row = c as { id: string; name: string };
      const evalDetail = await getCompanyEvalDetail(row.id);
      const specificFixes = (evalDetail?.results ?? [])
        .filter((r) => r.fix && r.verdict === 'fail')
        .map((r) => ({ question: r.question, fix: r.fix }));
      return {
        companyId: row.id,
        companyName: row.name ?? 'Company',
        answerQuality: evalDetail?.avgAnswerScore ?? null,
        setupCompleted: 0,
        setupTotal: 0,
        specificFixes,
        fixes: [],
      } satisfies ImprovementReport;
    }),
  );
  return reports.sort((a, b) => {
    const qa = a.answerQuality ?? 999;
    const qb = b.answerQuality ?? 999;
    if (qa !== qb) return qa - qb;
    return b.specificFixes.length - a.specificFixes.length;
  });
}

async function companyAdminEmails(companyId: string): Promise<string[]> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('company_users')
    .select('users(email)')
    .eq('company_id', companyId)
    .eq('role', 'company_admin');
  const out: string[] = [];
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const u = row.users as { email?: string } | { email?: string }[] | null;
    const email = Array.isArray(u) ? u[0]?.email : u?.email;
    if (email) out.push(email);
  }
  return out;
}

function reportHtml(report: ImprovementReport): string {
  const appUrl = env.NEXT_PUBLIC_APP_URL;
  const top = report.fixes.slice(0, 6);
  const quality =
    report.answerQuality != null
      ? `<p style="font-size:15px">Your assistant currently answers about <strong>${report.answerQuality}%</strong> of test questions well.</p>`
      : '';
  const items = top
    .map((f) => {
      const impact = f.impact === 'high' ? 'High impact' : 'Medium';
      const color = f.impact === 'high' ? '#b45309' : '#6b7280';
      return `<li style="margin-bottom:12px">
        <strong>${f.title}</strong>
        <span style="color:${color};font-size:12px"> · ${impact}</span><br/>
        <span style="color:#4b5563;font-size:13px">${f.description}</span><br/>
        <span style="color:#6b7280;font-size:12px">Where: ${whereLabel(f.ctaHref)}</span>
      </li>`;
    })
    .join('');

  // Specific "add/update X in Y place" fixes from the latest graded test.
  const specific = report.specificFixes.slice(0, 8);
  const specificHtml = specific.length
    ? `<p style="font-weight:600;margin-top:16px">Based on real test answers, please update:</p>
       <ul style="padding-left:18px">${specific
         .map(
           (s) => `<li style="margin-bottom:12px">
             <span style="color:#4b5563;font-size:13px">When customers ask "<em>${s.question}</em>":</span><br/>
             <strong style="font-size:14px">${s.fix}</strong>
           </li>`,
         )
         .join('')}</ul>`
    : '';

  return `<div style="font-family:Arial,sans-serif;max-width:560px;color:#111827">
    <h2 style="margin:0 0 8px">Make your assistant answer better</h2>
    <p style="color:#4b5563">Hi ${report.companyName}, here is how to improve your website assistant's answers.</p>
    ${quality}
    ${specificHtml}
    ${top.length ? `<p style="font-weight:600;margin-top:16px">Also add to your setup:</p><ul style="padding-left:18px">${items}</ul>` : ''}
    ${!specific.length && !top.length ? '<p>Your assistant looks healthy — nothing to fix right now.</p>' : ''}
    <p style="margin-top:20px">
      <a href="${appUrl}/company/quality" style="background:#1d4ed8;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:14px">Open your Quality Room</a>
    </p>
    <p style="color:#9ca3af;font-size:12px;margin-top:24px">You can test any change instantly in your Quality Room before customers see it.</p>
  </div>`;
}

/** Build + email a company's improvement report to its admins. */
export async function sendImprovementEmail(companyId: string): Promise<{ sent: boolean; reason?: string }> {
  const report = await buildImprovementReport(companyId);
  const emails = await companyAdminEmails(companyId);
  if (emails.length === 0) return { sent: false, reason: 'no_admin_email' };
  let sent = false;
  for (const to of emails) {
    const res = await sendEmail({
      to,
      subject: `Improve your assistant — ${report.fixes.length} suggestion${report.fixes.length === 1 ? '' : 's'}`,
      html: reportHtml(report),
    });
    sent = sent || res.sent;
  }
  return { sent };
}
