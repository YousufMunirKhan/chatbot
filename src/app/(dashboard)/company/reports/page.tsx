import { requireRole } from '@/lib/auth';
import { InfoHint } from '@/components/ui/info-hint';
import { CHANNEL_LABELS, ROLES, humanizeToken, labelFor } from '@/lib/constants';
import { companyLabel } from '@/lib/labels';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile } from '@/components/ui/stat-tile';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TabLinks } from '@/components/ui/tabs';
import {
  getAssistantReport,
  getCustomersReport,
  getReportsSnapshot,
  getSalesReport,
  getTeamReport,
} from '@/modules/company/reports-data';
import {
  DAY_LABELS,
  describeHeatmapCell,
  type HourHeatmap,
} from '@/modules/company/reports-metrics';

export const dynamic = 'force-dynamic';

const RANGES = [7, 30, 90];

const TABS = [
  {
    key: 'overview',
    label: 'Overview',
    helper: 'Volume, channels, guided chats and when your customers actually show up.',
  },
  {
    key: 'team',
    label: 'Team',
    helper: 'Who handled what, how fast they replied and what is on their plate now.',
  },
  {
    key: 'customers',
    label: 'Customers',
    helper: 'From first chat to a paying customer, plus who books and who buys.',
  },
  {
    key: 'assistant',
    label: 'Assistant',
    helper: 'How much the AI finishes alone, and the questions it could not answer.',
  },
  {
    key: 'sales',
    label: 'Sales & campaigns',
    helper: 'Orders that started in chat, cart recovery, broadcasts and automations.',
  },
] as const;

type TabKey = (typeof TABS)[number]['key'];

function isTab(value: string | undefined): value is TabKey {
  return TABS.some((t) => t.key === value);
}

const href = (tab: TabKey, days: number) => `/company/reports?tab=${tab}&days=${days}`;

/**
 * A dependency-free sparkline. A charting library would be several hundred
 * kilobytes of client JavaScript for one trend line on a server-rendered page;
 * an inline SVG polyline is a few hundred bytes and ships no JS at all.
 */
function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const width = 600;
  const height = 60;
  const step = width / (values.length - 1);
  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(height - (v / max) * (height - 6) - 3).toFixed(1)}`)
    .join(' ');
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-16 w-full"
      role="img"
      aria-label={`${label}: peak ${max}`}
      preserveAspectRatio="none"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="text-primary"
      />
    </svg>
  );
}

function Bar({ value, max }: { value: number; max: number }) {
  const pct = max === 0 ? 0 : Math.round((value / max) * 100);
  return (
    <span className="flex items-center gap-2">
      <span className="h-2 w-24 overflow-hidden rounded-full bg-muted">
        <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </span>
      <span className="tabular-nums">{value}</span>
    </span>
  );
}

/**
 * Busiest hours, 7 rows × 24 columns.
 *
 * A CSS grid of `<div>`s rather than an SVG: 168 cells each need their own
 * accessible label, and a grid gets that from ordinary markup with a `title`
 * and a screen-reader summary, where an SVG would need 168 `<title>` children
 * and manual layout arithmetic for the same result.
 */
function Heatmap({ data }: { data: HourHeatmap }) {
  if (data.total === 0) {
    return (
      <EmptyState
        title="No conversations in this period"
        body="Once chats come in, this grid shows the hours you need someone on hand."
      />
    );
  }
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <div className="min-w-[42rem] space-y-1">
          <div className="grid grid-cols-[2.5rem_repeat(24,1fr)] gap-px text-[10px] text-muted-foreground">
            <span aria-hidden="true" />
            {Array.from({ length: 24 }, (_, hour) => (
              <span key={hour} className="text-center">
                {hour % 3 === 0 ? hour : ''}
              </span>
            ))}
          </div>
          {data.grid.map((hours, day) => (
            <div key={day} className="grid grid-cols-[2.5rem_repeat(24,1fr)] items-center gap-px">
              <span className="text-xs text-muted-foreground">{DAY_LABELS[day]}</span>
              {hours.map((count, hour) => (
                <span
                  key={hour}
                  title={`${describeHeatmapCell(day, hour)} — ${count} conversation${count === 1 ? '' : 's'}`}
                  className="h-5 rounded-[2px] bg-primary"
                  // Opacity rather than a colour ramp: one token, and it stays
                  // legible in both themes without a second palette to verify.
                  style={{ opacity: count === 0 ? 0.06 : 0.2 + (count / data.max) * 0.8 }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {data.peak
          ? `Busiest: ${describeHeatmapCell(data.peak.day, data.peak.hour)} with ${data.peak.count} conversations. Times are UTC.`
          : 'Times are UTC.'}
      </p>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="px-6 pb-4 text-xs text-muted-foreground">{children}</p>;
}

const minutes = (value: number | null) =>
  value === null
    ? '—'
    : value < 1
      ? '< 1 min'
      : value < 60
        ? `${value} min`
        : `${Math.round((value / 60) * 10) / 10} h`;

const money = (value: number, currency: string) =>
  `${currency} ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ===========================================================================
// Panels
// ===========================================================================

async function OverviewPanel({ days }: { days: number }) {
  const snapshot = await getReportsSnapshot(days);
  const maxConversations = Math.max(...snapshot.channels.map((c) => c.conversations), 1);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Conversations"
          value={snapshot.totals.conversations}
          hint={`${snapshot.totals.messages} messages`}
        />
        <StatTile
          label="Handled by AI"
          value={`${snapshot.totals.automationRate}%`}
          hint={`${snapshot.totals.escalated} needed a person`}
          tone={snapshot.totals.automationRate >= 70 ? 'success' : 'default'}
        />
        <StatTile label="Leads captured" value={snapshot.totals.leads} href="/company/leads" />
        <StatTile
          label="CSAT"
          value={snapshot.totals.csatAverage === null ? '—' : `${snapshot.totals.csatAverage} / 5`}
          hint={`${snapshot.totals.csatResponses} ratings`}
          tone={
            snapshot.totals.csatAverage === null
              ? 'default'
              : snapshot.totals.csatAverage >= 4
                ? 'success'
                : snapshot.totals.csatAverage >= 3
                  ? 'warning'
                  : 'danger'
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Volume</CardTitle>
          <CardDescription>Conversations started per day.</CardDescription>
        </CardHeader>
        <CardContent>
          <Sparkline
            values={snapshot.daily.map((d) => d.conversations)}
            label="Conversations per day"
          />
          <div className="mt-1 flex justify-between text-xs text-muted-foreground">
            <span>{snapshot.daily[0]?.date}</span>
            <span>{snapshot.daily[snapshot.daily.length - 1]?.date}</span>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr] [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>Busiest hours</CardTitle>
            <CardDescription>When conversations start, by day of week and hour.</CardDescription>
          </CardHeader>
          <CardContent>
            <Heatmap data={snapshot.heatmap} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>First contact resolution</CardTitle>
            <CardDescription>
              Closed without a human, and the customer did not come back.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {snapshot.fcr.closed === 0 ? (
              <EmptyState
                title="Nothing closed yet"
                body="This needs conversations that reached a closed state. Chats still open, or expired without being closed, are not counted."
              />
            ) : (
              <>
                <p className="text-3xl font-semibold">{snapshot.fcr.rate}%</p>
                <p className="text-sm text-muted-foreground">
                  {snapshot.fcr.resolvedFirstContact} of {snapshot.fcr.closed} closed conversations
                  were finished on the first contact.
                </p>
                <p className="text-xs text-muted-foreground">
                  A conversation counts only if no agent replied and the same visitor did not start
                  another chat within 24 hours.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>By channel</CardTitle>
          <CardDescription>Every surface customers reached you on, busiest first.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {snapshot.channels.length === 0 ? (
            <EmptyState
              title="Nothing in this period"
              body="Once customers start messaging, this table shows which channels carry the load."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Channel</TableHead>
                  <TableHead>Conversations</TableHead>
                  <TableHead>Messages</TableHead>
                  <TableHead>
                    Handled by AI
                    <InfoHint label="Handled by AI">
                      Conversations on this channel that finished without ever needing one of your
                      team.
                    </InfoHint>
                  </TableHead>
                  <TableHead>Leads</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshot.channels.map((c) => (
                  <TableRow key={c.channel}>
                    <TableCell>
                      <Badge variant="outline">{c.label}</Badge>
                    </TableCell>
                    <TableCell>
                      <Bar value={c.conversations} max={maxConversations} />
                    </TableCell>
                    <TableCell className="tabular-nums">{c.messages}</TableCell>
                    <TableCell className="tabular-nums">{c.automationRate}%</TableCell>
                    <TableCell className="tabular-nums">{c.leads}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Flow performance</CardTitle>
          <CardDescription>
            How often a published flow runs to the end instead of being abandoned.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {snapshot.flows.length === 0 ? (
            <EmptyState
              title="No flow activity yet"
              body="Publish a flow and its starts, completions and drop-off appear here."
              action={
                <Button asChild size="sm">
                  <a href="/company/flows">Open the flow builder</a>
                </Button>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Flow</TableHead>
                  <TableHead>
                    People who started it
                    <InfoHint label="People who started it">
                      How many separate conversations reached this guided chat. Someone who goes
                      through it twice counts twice.
                    </InfoHint>
                  </TableHead>
                  <TableHead>Completions</TableHead>
                  <TableHead>
                    Reached the end
                    <InfoHint label="Reached the end">
                      The share of people who started this guided chat and got all the way to its
                      last step. A low number usually means one question is putting people off.
                    </InfoHint>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshot.flows.map((f) => (
                  <TableRow key={f.flowId}>
                    <TableCell className="font-medium">{f.name}</TableCell>
                    <TableCell className="tabular-nums">{f.starts}</TableCell>
                    <TableCell className="tabular-nums">{f.completions}</TableCell>
                    <TableCell className="tabular-nums">{f.completionRate}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/*
        ===================================================================
        AI INSIGHTS SLOT — owned by the insights workstream, deliberately empty.

        Drop the insights section in here. `src/modules/company/insights-data.ts`
        already exposes `listInsights()`, `getLatestInsightRun()` and
        `getInsightCounts()`, all of which scope themselves to the session's
        company, so this slot needs to pass nothing — `days` is in scope above
        if a range-aware variant is added later.

        Nothing in this file or in `reports-data.ts` reads, writes or imports
        that module; the two workstreams share only this line. Keep the section
        inside this `space-y-6` stack and start it with a `<Card>` so it picks
        up the same rhythm as the panels above.
        ===================================================================
      */}
    </div>
  );
}

async function TeamPanel({ days }: { days: number }) {
  const report = await getTeamReport(days);
  const withActivity = report.agents.filter(
    (a) => a.conversations > 0 || a.messagesSent > 0 || a.openLoad > 0,
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Active teammates"
          value={report.totals.agentsActive}
          hint={`${report.agents.length} on the team`}
        />
        <StatTile label="Conversations handled" value={report.totals.conversationsHandled} />
        <StatTile label="Replies sent" value={report.totals.messagesSent} />
        <StatTile
          label="Median first reply"
          value={minutes(report.totals.medianFirstResponseMinutes)}
          hint={report.slaEventsUsed ? 'From the SLA clock' : 'From the message timeline'}
        />
      </div>

      {report.totals.unassignedOpen > 0 ? (
        <Alert tone="warning" title="Unassigned conversations">
          {report.totals.unassignedOpen} open conversation
          {report.totals.unassignedOpen === 1 ? ' is' : 's are'} not assigned to anyone, so{' '}
          {report.totals.unassignedOpen === 1 ? 'it does' : 'they do'} not appear against a teammate
          below.
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Per teammate</CardTitle>
          <CardDescription>
            Handled counts a conversation once, whether the teammate was assigned it or replied in
            it.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {withActivity.length === 0 ? (
            <EmptyState
              title="No agent activity in this period"
              body="Numbers appear here once teammates reply in the inbox or conversations are assigned to them."
              action={
                <Button asChild size="sm">
                  <a href="/company/inbox">Open the inbox</a>
                </Button>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Teammate</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Conversations</TableHead>
                  <TableHead>Replies</TableHead>
                  <TableHead>Median first reply</TableHead>
                  <TableHead>CSAT</TableHead>
                  <TableHead>Open now</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {withActivity.map((a) => (
                  <TableRow key={a.userId}>
                    <TableCell>
                      <span className="font-medium">{a.name}</span>
                      {a.email && a.email !== a.name ? (
                        <span className="block text-xs text-muted-foreground">{a.email}</span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{companyLabel('role', a.role)}</Badge>
                    </TableCell>
                    <TableCell className="tabular-nums">{a.conversations}</TableCell>
                    <TableCell className="tabular-nums">{a.messagesSent}</TableCell>
                    <TableCell className="tabular-nums">
                      {minutes(a.medianFirstResponseMinutes)}
                      {a.firstResponseSamples > 0 ? (
                        <span className="ms-1 text-xs text-muted-foreground">
                          ({a.firstResponseSamples})
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {a.csatAverage === null ? '—' : `${a.csatAverage} / 5`}
                      {a.csatResponses > 0 ? (
                        <span className="ms-1 text-xs text-muted-foreground">
                          ({a.csatResponses})
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="tabular-nums">{a.openLoad}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
        <Note>
          {report.slaEventsUsed
            ? 'First reply is read from the SLA clock, which is stamped by the SLA cron.'
            : 'No SLA policy has recorded a response yet, so first reply is measured from the first customer message to the first agent message.'}{' '}
          &ldquo;Open now&rdquo; is live and ignores the date range.
        </Note>
      </Card>
    </div>
  );
}

async function CustomersPanel({ days }: { days: number }) {
  const report = await getCustomersReport(days);
  const start = report.funnel[0]?.count ?? 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Lead funnel</CardTitle>
          <CardDescription>Where people drop out between saying hello and buying.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {start === 0 ? (
            <EmptyState
              title="No conversations in this period"
              body="The funnel starts from conversations."
            />
          ) : (
            report.funnel.map((stage, index) => (
              <div key={stage.key} className="space-y-1">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium">{stage.label}</span>
                  <span className="tabular-nums">
                    {stage.count}
                    <span className="ms-2 text-xs text-muted-foreground">
                      {stage.ofStart}% of chats
                      {index > 0 ? ` · ${stage.ofPrevious}% of previous step` : ''}
                    </span>
                  </span>
                </div>
                <span className="block h-2 w-full overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-primary"
                    style={{ width: `${stage.ofStart}%` }}
                  />
                </span>
                {stage.hint ? <p className="text-xs text-muted-foreground">{stage.hint}</p> : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>New vs returning</CardTitle>
            <CardDescription>Counted inside the selected period only.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {report.visitors.identified === 0 ? (
              <EmptyState
                title="No identified visitors"
                body="Web chat stores a visitor id in the browser. Conversations arriving from other channels without one cannot be told apart."
              />
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <StatTile
                    label="New"
                    value={report.visitors.newVisitors}
                    hint="One conversation"
                  />
                  <StatTile
                    label="Returning"
                    value={report.visitors.returningVisitors}
                    hint={`${report.visitors.returningRate}% of visitors`}
                    tone="info"
                  />
                </div>
                {report.visitors.anonymous > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {report.visitors.anonymous} conversation
                    {report.visitors.anonymous === 1 ? '' : 's'} carried no visitor id and{' '}
                    {report.visitors.anonymous === 1 ? 'is' : 'are'} excluded.
                  </p>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Appointments</CardTitle>
            <CardDescription>Booked in this period, and how they ended.</CardDescription>
          </CardHeader>
          <CardContent>
            {report.appointments.booked === 0 ? (
              <EmptyState
                title="No appointments booked"
                body="Turn on appointment booking so the assistant can take bookings, and they will be tracked here."
                action={
                  <Button asChild size="sm">
                    <a href="/company/appointments">Open appointments</a>
                  </Button>
                }
              />
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <StatTile label="Booked" value={report.appointments.booked} />
                <StatTile label="Confirmed" value={report.appointments.confirmed} />
                <StatTile
                  label="Completed"
                  value={report.appointments.completed}
                  hint={`${report.appointments.completionRate}% of bookings`}
                  tone="success"
                />
                <StatTile label="Cancelled" value={report.appointments.cancelled} />
                <StatTile label="No show" value={report.appointments.noShow} tone="warning" />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Leads by status</CardTitle>
          <CardDescription>Your pipeline as it stands today.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {report.leadsByStatus.length === 0 ? (
            <EmptyState
              title="No leads in this period"
              body="Captured contact details appear here as they arrive."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Leads</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.leadsByStatus.map((s) => (
                  <TableRow key={s.status}>
                    <TableCell>
                      <Badge variant="outline">{s.label}</Badge>
                    </TableCell>
                    <TableCell className="tabular-nums">{s.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Top customers</CardTitle>
          <CardDescription>
            By order value in this period, chat orders and store orders combined.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {report.topCustomers.length === 0 ? (
            <EmptyState
              title="No orders in this period"
              body="This ranks customers by orders placed in chat or synced from your store. Connect a store or take an order in chat to fill it."
              action={
                <Button asChild size="sm">
                  <a href="/company/integrations">Connect a store</a>
                </Button>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Orders</TableHead>
                  <TableHead>Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.topCustomers.map((c) => (
                  <TableRow key={c.key}>
                    <TableCell>
                      <span className="font-medium">{c.name}</span>
                      {c.contact && c.contact !== c.name ? (
                        <span className="block text-xs text-muted-foreground">{c.contact}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="tabular-nums">{c.orders}</TableCell>
                    <TableCell className="tabular-nums">
                      {money(c.value, c.currency)}
                      {c.mixedCurrency ? (
                        <span className="ms-1 text-xs text-warning-fg">
                          mixed currencies, not converted
                        </span>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
        {report.storeOrdersPresent ? (
          <Note>
            Store orders are only as fresh as the last catalogue sync, and the sync job has no
            schedule in
            <code className="mx-1">vercel.json</code> — it must be triggered for these numbers to be
            current.
          </Note>
        ) : null}
      </Card>
    </div>
  );
}

async function AssistantPanel({ days }: { days: number }) {
  const report = await getAssistantReport(days);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Sorted without a person"
          value={`${report.containmentRate}%`}
          hint={`${report.containedConversations} of ${report.conversations} needed no human`}
          tone={
            report.containmentRate >= 70
              ? 'success'
              : report.containmentRate >= 40
                ? 'warning'
                : 'default'
          }
        />
        <StatTile
          label="Messages to resolution"
          value={report.averageMessagesToResolution ?? '—'}
          hint={`${report.resolvedConversations} closed conversations`}
        />
        <StatTile
          label="CSAT — AI only"
          value={report.csat.aiOnly.average === null ? '—' : `${report.csat.aiOnly.average} / 5`}
          hint={`${report.csat.aiOnly.responses} ratings`}
        />
        <StatTile
          label="CSAT — human helped"
          value={
            report.csat.humanTouched.average === null
              ? '—'
              : `${report.csat.humanTouched.average} / 5`
          }
          hint={`${report.csat.humanTouched.responses} ratings`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Questions the assistant could not answer</CardTitle>
          <CardDescription>
            Grouped by question. Each of these is a gap you can close by adding one answer to your
            knowledge base.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {!report.qualityLoggingActive ? (
            <EmptyState
              title="Answer quality logging has recorded nothing"
              body="This list is built from the assistant's own quality log. No entries were written in this period, so there is nothing to show — send a few test messages, or check that the assistant is answering at all."
              action={
                <Button asChild size="sm">
                  <a href="/company/quality">Open answer quality</a>
                </Button>
              }
            />
          ) : report.unanswered.length === 0 ? (
            <EmptyState
              title="Nothing went unanswered"
              body="Every logged answer in this period found the information it needed."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Question</TableHead>
                  <TableHead>Times asked</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.unanswered.map((q) => (
                  <TableRow key={q.question}>
                    <TableCell className="max-w-xl">{q.question}</TableCell>
                    <TableCell className="tabular-nums">{q.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
        {report.qualityLoggingActive ? (
          <Note>
            {report.unansweredTotal} answer{report.unansweredTotal === 1 ? '' : 's'} in this period
            were flagged as missing information or weak retrieval by the assistant itself.
          </Note>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Top topics</CardTitle>
          <CardDescription>
            The words customers use most, with filler words removed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {report.topics.length === 0 ? (
            <EmptyState
              title="Not enough customer messages yet"
              body="Topics appear once customers have written in."
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              {report.topics.map((t) => (
                <span
                  key={t.term}
                  className="inline-flex items-center gap-2 rounded-full border bg-muted/40 px-3 py-1 text-sm"
                >
                  {t.term}
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {t.count} · {t.share}%
                  </span>
                </span>
              ))}
            </div>
          )}
        </CardContent>
        <Note>
          Counted over the {report.topicSampleSize} most recent customer messages in this period.
        </Note>
      </Card>
    </div>
  );
}

async function SalesPanel({ days }: { days: number }) {
  const report = await getSalesReport(days);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Orders"
          value={report.orders.total}
          hint={`${report.orders.storeSynced} synced from a store`}
        />
        <StatTile
          label="Started in chat"
          value={report.orders.fromChat}
          hint={`${report.orders.chatAttributionRate}% of all orders`}
          tone="success"
        />
        <StatTile
          label="Carts abandoned"
          value={report.carts.abandoned}
          hint={`${report.carts.created} carts created`}
        />
        <StatTile
          label="Carts recovered"
          value={report.carts.recovered}
          hint={`${report.carts.recoveryRate}% of abandoned`}
          tone={report.carts.recovered > 0 ? 'success' : 'default'}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Revenue</CardTitle>
          <CardDescription>
            Order value in this period. Cancelled orders are excluded.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {report.revenueByCurrency.length === 0 ? (
            <EmptyState
              title="No orders in this period"
              body="Revenue is read from chat orders and store orders. Take an order in chat or connect a store to see it here."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Currency</TableHead>
                  <TableHead>Orders</TableHead>
                  <TableHead>Order value</TableHead>
                  <TableHead>Paid</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.revenueByCurrency.map((r) => (
                  <TableRow key={r.currency}>
                    <TableCell>
                      <Badge variant="outline">{r.currency}</Badge>
                    </TableCell>
                    <TableCell className="tabular-nums">{r.orders}</TableCell>
                    <TableCell className="tabular-nums">{money(r.total, r.currency)}</TableCell>
                    <TableCell className="tabular-nums">{money(r.paid, r.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
        <Note>
          Currencies are listed separately rather than summed — this product stores no exchange
          rates, and adding them together would invent a number.
          {report.orders.storeSynced > 0 ? (
            <>
              {' '}
              Store orders arrive through the catalogue sync, which has no schedule in
              <code className="mx-1">vercel.json</code> and must be triggered for these totals to be
              current.
            </>
          ) : null}
        </Note>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Abandoned cart recovery</CardTitle>
          <CardDescription>Carts left behind, messaged, and rescued.</CardDescription>
        </CardHeader>
        <CardContent>
          {!report.carts.detectorActive ? (
            <EmptyState
              title="Cart abandonment detection is switched off"
              body="Carts are only marked as abandoned for companies with an active “cart abandoned” automation rule. Without one, the detector never runs and this stays at zero — which is not the same as nobody abandoning a cart."
              action={
                <Button asChild size="sm">
                  <a href="/company/automations">Set up an automation</a>
                </Button>
              }
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Created" value={report.carts.created} />
              <StatTile label="Abandoned" value={report.carts.abandoned} />
              <StatTile label="Messaged" value={report.carts.recoveryMessaged} />
              <StatTile
                label="Recovered"
                value={report.carts.recovered}
                hint={`${report.carts.recoveryRate}%`}
                tone="success"
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Broadcasts</CardTitle>
          <CardDescription>Scheduled campaigns sent to your contact list.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {report.broadcasts.campaigns === 0 ? (
            <EmptyState
              title="No broadcasts in this period"
              body="Send a WhatsApp or email campaign and its delivery numbers appear here."
              action={
                <Button asChild size="sm">
                  <a href="/company/broadcasts">Create a broadcast</a>
                </Button>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Channel</TableHead>
                  <TableHead>Campaigns</TableHead>
                  <TableHead>Recipients</TableHead>
                  <TableHead>Failed campaigns</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.broadcasts.byChannel.map((c) => (
                  <TableRow key={c.channel}>
                    <TableCell>
                      <Badge variant="outline">{c.label}</Badge>
                    </TableCell>
                    <TableCell className="tabular-nums">{c.campaigns}</TableCell>
                    <TableCell className="tabular-nums">{c.recipients}</TableCell>
                    <TableCell className="tabular-nums">{c.failed}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
        {report.broadcasts.campaigns > 0 ? (
          <Note>
            A broadcast records how many recipients it was sent to and whether the campaign as a
            whole failed. Per recipient delivery, opens and replies are not stored, so they cannot
            be reported.
          </Note>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Automations</CardTitle>
          <CardDescription>Post-purchase and recovery messages, by rule.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {report.automations.length === 0 ? (
            <EmptyState
              title="No automation runs in this period"
              body="Create a rule such as “order shipped” or “cart abandoned” and every message it sends is counted here."
              action={
                <Button asChild size="sm">
                  <a href="/company/automations">Open automations</a>
                </Button>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rule</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Failed</TableHead>
                  <TableHead>Waiting</TableHead>
                  <TableHead>Success</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.automations.map((a) => (
                  <TableRow key={a.ruleId}>
                    <TableCell className="font-medium">{a.name}</TableCell>
                    <TableCell>{humanizeToken(a.trigger)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{labelFor(CHANNEL_LABELS, a.channel)}</Badge>
                    </TableCell>
                    <TableCell className="tabular-nums">{a.sent}</TableCell>
                    <TableCell className="tabular-nums">{a.failed}</TableCell>
                    <TableCell className="tabular-nums">{a.pending}</TableCell>
                    <TableCell className="tabular-nums">{a.successRate}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ===========================================================================
// Page
// ===========================================================================

export default async function ReportsPage({
  searchParams,
}: {
  searchParams?: { days?: string; tab?: string };
}) {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const requested = Number(searchParams?.days);
  const days = RANGES.includes(requested) ? requested : 30;
  const tab: TabKey = isTab(searchParams?.tab) ? searchParams.tab : 'overview';

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Reports"
        description="Where your chats come from, how many your assistant finished without you, who on your team is carrying them, and what any of it earned."
        actions={
          <Button asChild size="sm" variant="outline">
            <a href={`/api/company/reports/export?tab=${tab}&days=${days}`}>
              Export this tab (CSV)
            </a>
          </Button>
        }
      />

      <div className="flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <Button key={r} asChild size="sm" variant={r === days ? 'default' : 'outline'}>
            <a href={href(tab, r)}>Last {r} days</a>
          </Button>
        ))}
      </div>

      <TabLinks
        label="Report sections"
        active={tab}
        items={TABS.map((t) => ({
          key: t.key,
          label: t.label,
          helper: t.helper,
          href: href(t.key, days),
        }))}
      >
        {tab === 'overview' ? <OverviewPanel days={days} /> : null}
        {tab === 'team' ? <TeamPanel days={days} /> : null}
        {tab === 'customers' ? <CustomersPanel days={days} /> : null}
        {tab === 'assistant' ? <AssistantPanel days={days} /> : null}
        {tab === 'sales' ? <SalesPanel days={days} /> : null}
      </TabLinks>
    </div>
  );
}
