import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { getCompanyId } from '@/modules/company/data';
import { InboxRealtime } from '@/modules/company/components/inbox-realtime';
import {
  conversationSource,
  conversationTicketNumber,
  listConversations,
  slaLabel,
  summarizeCsat,
  summarizeInboxSla,
  isConversationOverdue,
  type ConversationRow,
} from '@/modules/company/inbox-data';
import { getSupportSettings, isWithinBusinessHours } from '@/modules/company/support-settings-data';

type BadgeVariant = 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline';
type InboxFilter = 'all' | 'customer' | 'helpdesk' | 'connector' | 'manual' | 'urgent' | 'unassigned';

function statusVariant(status: string): BadgeVariant {
  if (status === 'ai_active') return 'secondary';
  if (status === 'needs_human') return 'warning';
  if (status === 'human_active') return 'warning';
  if (status === 'closed') return 'outline';
  return 'outline';
}

function displayStatus(conversation: Pick<ConversationRow, 'status' | 'aiEnabled'>): string {
  if (conversation.status === 'closed' || conversation.status === 'expired' || conversation.status === 'needs_human') {
    return conversation.status;
  }
  return conversation.aiEnabled ? 'ai_active' : 'human_active';
}

function statusLabel(status: string): string {
  if (status === 'ai_active') return 'AI active';
  return status
    .replace(/_/g, ' ')
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

function shortId(id: string | null): string {
  if (!id) return 'Visitor';
  return id.length > 8 ? id.slice(0, 8) : id;
}

function sourceLabel(source: ReturnType<typeof conversationSource>): string {
  if (source === 'helpdesk') return 'Help Desk chat';
  if (source === 'connector') return 'Connector failure';
  if (source === 'manual') return 'Manual';
  return 'Customer chat';
}

function sourceVariant(source: ReturnType<typeof conversationSource>): BadgeVariant {
  if (source === 'connector') return 'destructive';
  if (source === 'helpdesk') return 'secondary';
  if (source === 'manual') return 'outline';
  return 'success';
}

function normalizeFilter(value: string | undefined): InboxFilter {
  const filters: InboxFilter[] = ['all', 'customer', 'helpdesk', 'connector', 'manual', 'urgent', 'unassigned'];
  return filters.includes(value as InboxFilter) ? (value as InboxFilter) : 'all';
}

function filterHref(filter: InboxFilter): string {
  return filter === 'all' ? '/company/inbox' : `/company/inbox?source=${filter}`;
}

export default async function InboxPage({ searchParams }: { searchParams?: { source?: string } }) {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const [convos, companyId, support] = await Promise.all([
    listConversations(),
    getCompanyId(),
    getSupportSettings(),
  ]);
  const sla = summarizeInboxSla(convos, support.slaResponseMinutes);
  const csat = summarizeCsat(convos);
  const openNow = isWithinBusinessHours(support.businessHours);
  const activeFilter = normalizeFilter(searchParams?.source);
  const filteredConvos = convos.filter((c) => {
    if (activeFilter === 'urgent') return c.priority === 'urgent';
    if (activeFilter === 'unassigned') return !c.assignedAgentId && ['needs_human', 'human_active'].includes(c.status);
    if (['customer', 'helpdesk', 'connector', 'manual'].includes(activeFilter)) return conversationSource(c) === activeFilter;
    return true;
  });
  const filters: Array<[InboxFilter, string]> = [
    ['all', 'All'],
    ['customer', 'Customer'],
    ['helpdesk', 'Help Desk'],
    ['connector', 'Connector failures'],
    ['manual', 'Manual'],
    ['urgent', 'Urgent'],
    ['unassigned', 'Unassigned'],
  ];

  return (
    <div className="space-y-6">
      <InboxRealtime companyId={companyId} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Inbox</h1>
          <p className="text-sm text-muted-foreground">
            Customer chats, Help Desk tickets, connector failures, and manual support work.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Badge variant={openNow ? 'success' : 'outline'}>
            {support.businessHours.enabled ? (openNow ? 'Within hours' : 'Outside hours') : 'Always on'}
          </Badge>
          <Link href="/company/support-settings" className="text-sm font-medium text-primary hover:underline">
            Support settings
          </Link>
          <Link href="/company/inbox/canned" className="text-sm font-medium text-primary hover:underline">
            Saved replies
          </Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Needs human</p>
            <p className="mt-1 text-2xl font-semibold">{sla.needsHuman}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Missed SLA</p>
            <p className="mt-1 text-2xl font-semibold">{sla.missed}</p>
            <p className="text-xs text-muted-foreground">{sla.slaMinutes}m target</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Unassigned</p>
            <p className="mt-1 text-2xl font-semibold">{sla.unassigned}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">CSAT</p>
            <p className="mt-1 text-2xl font-semibold">
              {csat.average != null ? `${csat.average.toFixed(1)} stars` : '-'}
            </p>
            <p className="text-xs text-muted-foreground">{csat.responses} rated</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-wrap gap-2 border-b p-3">
            {filters.map(([key, label]) => (
              <Link
                key={key}
                href={filterHref(key)}
                className={[
                  'rounded-md border px-3 py-1.5 text-sm font-medium',
                  activeFilter === key ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted',
                ].join(' ')}
              >
                {label}
              </Link>
            ))}
          </div>
          {convos.length === 0 ? (
            // Module 1 — genuinely empty inbox: the widget is the thing that fills it.
            <div className="space-y-3 p-6">
              <p className="text-sm font-medium">No conversations yet</p>
              <p className="max-w-xl text-sm text-muted-foreground">
                Once the widget is live on your site, visitor chats land here. Help Desk reports and connector
                failures arrive in the same list.
              </p>
              <Button asChild size="sm">
                <Link href="/company/widget">Install the widget</Link>
              </Button>
            </div>
          ) : filteredConvos.length === 0 ? (
            // Module 2 — the inbox has conversations, this filter just hides them all.
            <div className="space-y-3 p-6">
              <p className="text-sm font-medium">No conversations match this filter</p>
              <p className="text-sm text-muted-foreground">
                You have {convos.length} conversation{convos.length === 1 ? '' : 's'} under other filters.
              </p>
              <Button asChild size="sm" variant="outline">
                <Link href="/company/inbox">Show all conversations</Link>
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Visitor</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>SLA</TableHead>
                  <TableHead>Unread</TableHead>
                  <TableHead>Assigned</TableHead>
                  <TableHead>CSAT</TableHead>
                  <TableHead>Last activity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredConvos.map((c) => {
                  const href = `/company/inbox/${c.id}`;
                  const status = displayStatus(c);
                  const source = conversationSource(c);
                  const currentSla = slaLabel(c, support.slaResponseMinutes);
                  const ticketNumber = conversationTicketNumber(c);
                  return (
                    <TableRow key={c.id} className="cursor-pointer">
                      <TableCell className="p-0">
                        <Link href={href} className="block px-3 py-2.5 font-medium hover:underline">
                          <span className="block">{ticketNumber}</span>
                          <span className="text-xs font-normal text-muted-foreground">{shortId(c.visitorId)}</span>
                        </Link>
                      </TableCell>
                      <TableCell className="p-0">
                        <Link href={href} className="block px-3 py-2.5">
                          <Badge variant={sourceVariant(source)}>{sourceLabel(source)}</Badge>
                        </Link>
                      </TableCell>
                      <TableCell className="p-0">
                        <Link href={href} className="flex items-center gap-1.5 px-3 py-2.5">
                          <Badge variant={statusVariant(status)}>{statusLabel(status)}</Badge>
                          {isConversationOverdue(c, support.slaResponseMinutes) ? (
                            <Badge variant="destructive">Overdue</Badge>
                          ) : null}
                        </Link>
                      </TableCell>
                      <TableCell className="p-0">
                        <Link href={href} className="block px-3 py-2.5">
                          <span className={currentSla.startsWith('Overdue') ? 'font-medium text-destructive' : 'text-muted-foreground'}>
                            {currentSla}
                          </span>
                        </Link>
                      </TableCell>
                      <TableCell className="p-0">
                        <Link href={href} className="block px-3 py-2.5">
                          {c.unreadCount > 0 ? <Badge>{c.unreadCount}</Badge> : <span className="text-muted-foreground">-</span>}
                        </Link>
                      </TableCell>
                      <TableCell className="p-0">
                        <Link href={href} className="block px-3 py-2.5">
                          {c.assignedAgentId ? 'Assigned' : <span className="text-muted-foreground">Unassigned</span>}
                        </Link>
                      </TableCell>
                      <TableCell className="p-0">
                        <Link href={href} className="block px-3 py-2.5">
                          {c.csatRating ? (
                            <span className="font-medium text-amber-600">{c.csatRating} stars</span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </Link>
                      </TableCell>
                      <TableCell className="p-0">
                        <Link href={href} className="block px-3 py-2.5 text-muted-foreground">
                          {formatDate(c.lastMessageAt)}
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
