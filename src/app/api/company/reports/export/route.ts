import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { handleApiError } from '@/lib/errors';
import {
  getAssistantReport,
  getCustomersReport,
  getReportsSnapshot,
  getSalesReport,
  getTeamReport,
} from '@/modules/company/reports-data';
import { DAY_LABELS, toCsv } from '@/modules/company/reports-metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RANGES = [7, 30, 90];
const TABS = ['overview', 'team', 'customers', 'assistant', 'sales'] as const;
type Tab = (typeof TABS)[number];

interface Sheet {
  header: string[];
  rows: Array<Array<unknown>>;
}

/**
 * One CSV per report tab.
 *
 * The export deliberately reuses the same `*Report` readers the page renders
 * from rather than issuing its own queries. A second set of queries is a second
 * definition of every metric, and the first time one of them drifted the
 * spreadsheet and the screen would disagree with no way to tell which was
 * right. Company-scoping therefore also comes for free: every reader binds to
 * `getCompanyId()` from the session, never to anything in the request.
 */
async function build(tab: Tab, days: number): Promise<Sheet> {
  if (tab === 'overview') {
    const r = await getReportsSnapshot(days);
    const rows: Array<Array<unknown>> = [];
    for (const c of r.channels) {
      rows.push(['channel', c.label, c.conversations, c.messages, `${c.automationRate}%`, c.leads]);
    }
    for (const d of r.daily) rows.push(['day', d.date, d.conversations, d.messages, '', '']);
    for (const f of r.flows) rows.push(['flow', f.name, f.starts, f.completions, `${f.completionRate}%`, '']);
    for (let day = 0; day < 7; day += 1) {
      for (let hour = 0; hour < 24; hour += 1) {
        const count = r.heatmap.grid[day]?.[hour] ?? 0;
        if (count > 0) rows.push(['busiest_hour', `${DAY_LABELS[day]} ${String(hour).padStart(2, '0')}:00`, count, '', '', '']);
      }
    }
    rows.push([
      'first_contact_resolution',
      'closed conversations resolved on first contact',
      r.fcr.resolvedFirstContact,
      r.fcr.closed,
      r.fcr.rate === null ? '' : `${r.fcr.rate}%`,
      '',
    ]);
    return { header: ['section', 'name', 'value_1', 'value_2', 'value_3', 'value_4'], rows };
  }

  if (tab === 'team') {
    const r = await getTeamReport(days);
    return {
      header: [
        'teammate',
        'email',
        'role',
        'conversations',
        'replies_sent',
        'median_first_reply_minutes',
        'first_reply_samples',
        'csat_average',
        'csat_responses',
        'open_now',
      ],
      rows: r.agents.map((a) => [
        a.name,
        a.email,
        a.role,
        a.conversations,
        a.messagesSent,
        a.medianFirstResponseMinutes ?? '',
        a.firstResponseSamples,
        a.csatAverage ?? '',
        a.csatResponses,
        a.openLoad,
      ]),
    };
  }

  if (tab === 'customers') {
    const r = await getCustomersReport(days);
    const rows: Array<Array<unknown>> = [];
    for (const s of r.funnel) rows.push(['funnel', s.label, s.count, `${s.ofStart}%`, `${s.ofPrevious}%`]);
    rows.push(['visitors', 'New (in period)', r.visitors.newVisitors, '', '']);
    rows.push(['visitors', 'Returning (in period)', r.visitors.returningVisitors, `${r.visitors.returningRate}%`, '']);
    rows.push(['visitors', 'No visitor id', r.visitors.anonymous, '', '']);
    for (const s of r.leadsByStatus) rows.push(['lead_status', s.label, s.count, '', '']);
    rows.push(['appointments', 'Booked', r.appointments.booked, '', '']);
    rows.push(['appointments', 'Confirmed', r.appointments.confirmed, '', '']);
    rows.push(['appointments', 'Completed', r.appointments.completed, `${r.appointments.completionRate}%`, '']);
    rows.push(['appointments', 'Cancelled', r.appointments.cancelled, '', '']);
    rows.push(['appointments', 'No show', r.appointments.noShow, '', '']);
    for (const c of r.topCustomers) {
      rows.push(['top_customer', c.name, c.orders, c.value, c.mixedCurrency ? 'mixed' : c.currency]);
    }
    return { header: ['section', 'name', 'value_1', 'value_2', 'value_3'], rows };
  }

  if (tab === 'assistant') {
    const r = await getAssistantReport(days);
    const rows: Array<Array<unknown>> = [
      ['summary', 'Conversations', r.conversations, ''],
      ['summary', 'Contained (no human)', r.containedConversations, `${r.containmentRate}%`],
      ['summary', 'Average messages to resolution', r.averageMessagesToResolution ?? '', r.resolvedConversations],
      ['summary', 'CSAT AI only', r.csat.aiOnly.average ?? '', r.csat.aiOnly.responses],
      ['summary', 'CSAT human helped', r.csat.humanTouched.average ?? '', r.csat.humanTouched.responses],
    ];
    for (const q of r.unanswered) rows.push(['unanswered_question', q.question, q.count, '']);
    for (const t of r.topics) rows.push(['topic', t.term, t.count, `${t.share}%`]);
    return { header: ['section', 'name', 'value_1', 'value_2'], rows };
  }

  const r = await getSalesReport(days);
  const rows: Array<Array<unknown>> = [
    ['orders', 'Total orders', r.orders.total, ''],
    ['orders', 'Started in chat', r.orders.fromChat, `${r.orders.chatAttributionRate}%`],
    ['orders', 'Synced from store', r.orders.storeSynced, ''],
  ];
  for (const m of r.revenueByCurrency) rows.push(['revenue', m.currency, m.total, m.paid]);
  rows.push(['carts', 'Created', r.carts.created, '']);
  rows.push(['carts', 'Abandoned', r.carts.abandoned, r.carts.detectorActive ? '' : 'detector inactive']);
  rows.push(['carts', 'Recovery messaged', r.carts.recoveryMessaged, '']);
  rows.push(['carts', 'Recovered', r.carts.recovered, `${r.carts.recoveryRate}%`]);
  for (const c of r.broadcasts.byChannel) rows.push(['broadcast_channel', c.label, c.recipients, c.campaigns]);
  for (const a of r.automations) rows.push([`automation:${a.trigger}`, a.name, a.sent, `${a.failed} failed`]);
  return { header: ['section', 'name', 'value_1', 'value_2'], rows };
}

/** Export the active reports tab as CSV. Company-admin only, own company only. */
export async function GET(req: Request) {
  try {
    await requireRole([ROLES.COMPANY_ADMIN]);
    const url = new URL(req.url);
    const rawTab = url.searchParams.get('tab') ?? 'overview';
    const tab = (TABS as readonly string[]).includes(rawTab) ? (rawTab as Tab) : 'overview';
    const rawDays = Number(url.searchParams.get('days'));
    const days = RANGES.includes(rawDays) ? rawDays : 30;

    const sheet = await build(tab, days);
    const csv = toCsv(sheet.header, sheet.rows);

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="reports-${tab}-${days}d.csv"`,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
