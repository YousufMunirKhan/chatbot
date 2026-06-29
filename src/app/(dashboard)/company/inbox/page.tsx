import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { getCompanyId } from '@/modules/company/data';
import { InboxRealtime } from '@/modules/company/components/inbox-realtime';
import {
  listConversations,
  summarizeInboxSla,
  summarizeCsat,
  isConversationOverdue,
  type ConversationRow,
} from '@/modules/company/inbox-data';
import { getSupportSettings, isWithinBusinessHours } from '@/modules/company/support-settings-data';

type BadgeVariant = 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline';

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

export default async function InboxPage() {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const [convos, companyId, support] = await Promise.all([
    listConversations(),
    getCompanyId(),
    getSupportSettings(),
  ]);
  const sla = summarizeInboxSla(convos, support.slaResponseMinutes);
  const csat = summarizeCsat(convos);
  const openNow = isWithinBusinessHours(support.businessHours);

  return (
    <div className="space-y-6">
      <InboxRealtime companyId={companyId} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Inbox</h1>
          <p className="text-sm text-muted-foreground">
            All chats, leads, and order enquiries — with live human takeover.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Badge variant={openNow ? 'success' : 'outline'}>
            {support.businessHours.enabled ? (openNow ? 'Within hours' : 'Outside hours') : 'Always on'}
          </Badge>
          <Link href="/company/support-settings" className="text-sm font-medium text-primary hover:underline">
            Support settings →
          </Link>
          <Link href="/company/inbox/canned" className="text-sm font-medium text-primary hover:underline">
            Saved replies →
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
              {csat.average != null ? `${csat.average.toFixed(1)}★` : '-'}
            </p>
            <p className="text-xs text-muted-foreground">{csat.responses} rated</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {convos.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              No conversations yet. They&apos;ll appear here when visitors chat via the widget.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Visitor</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Language</TableHead>
                  <TableHead>Unread</TableHead>
                  <TableHead>Assigned</TableHead>
                  <TableHead>CSAT</TableHead>
                  <TableHead>Last activity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {convos.map((c) => {
                  const href = `/company/inbox/${c.id}`;
                  const status = displayStatus(c);
                  return (
                  <TableRow key={c.id} className="cursor-pointer">
                    <TableCell className="p-0">
                      <Link href={href} className="block px-3 py-2.5 font-medium hover:underline">
                        {shortId(c.visitorId)}
                      </Link>
                    </TableCell>
                    <TableCell className="p-0">
                      <Link href={href} className="block px-3 py-2.5">
                        <Badge variant="outline">{c.channel.replace(/_/g, ' ')}</Badge>
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
                      <Link href={href} className="block px-3 py-2.5">{c.language ?? '-'}</Link>
                    </TableCell>
                    <TableCell className="p-0">
                      <Link href={href} className="block px-3 py-2.5">
                        {c.unreadCount > 0 ? <Badge>{c.unreadCount}</Badge> : <span className="text-muted-foreground">-</span>}
                      </Link>
                    </TableCell>
                    <TableCell className="p-0">
                      <Link href={href} className="block px-3 py-2.5">
                        {c.assignedAgentId ? 'Assigned' : <span className="text-muted-foreground">-</span>}
                      </Link>
                    </TableCell>
                    <TableCell className="p-0">
                      <Link href={href} className="block px-3 py-2.5">
                        {c.csatRating ? (
                          <span className="font-medium text-amber-600">{c.csatRating}★</span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </Link>
                    </TableCell>
                    <TableCell className="p-0">
                      <Link href={href} className="block px-3 py-2.5 text-muted-foreground">{formatDate(c.lastMessageAt)}</Link>
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
