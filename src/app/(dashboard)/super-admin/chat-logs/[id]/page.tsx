import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { getChatLogDetail, type ChatMessageRow } from '@/modules/super-admin/chat-logs-data';

function label(value: string | null | undefined): string {
  if (!value) return 'Not audited';
  return value.replace(/_/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase());
}

function auditVariant(value: string | null): 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline' {
  if (value === 'perfect') return 'success';
  if (value === 'acceptable') return 'secondary';
  if (value === 'failed') return 'destructive';
  if (value === 'needs_review') return 'warning';
  return 'outline';
}

function senderLabel(senderType: string): string {
  if (senderType === 'ai') return 'AI';
  if (senderType === 'agent') return 'Agent';
  if (senderType === 'system') return 'System';
  return 'Visitor';
}

function cleanMessage(content: string): string {
  return content
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*---+\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function MessageBubble({ message }: { message: ChatMessageRow }) {
  if (message.senderType === 'system') {
    return (
      <div className="flex justify-center">
        <div className="max-w-[80%] rounded-full bg-muted px-3 py-1 text-center text-xs text-muted-foreground">
          {cleanMessage(message.content)}
        </div>
      </div>
    );
  }
  const right = message.senderType === 'ai' || message.senderType === 'agent';
  return (
    <div className={cn('flex', right ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[82%] rounded-lg px-3 py-2 text-sm',
          message.senderType === 'visitor' && 'bg-muted',
          message.senderType === 'ai' && 'bg-blue-50 text-blue-950',
          message.senderType === 'agent' && 'bg-primary/10',
        )}
      >
        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium">{senderLabel(message.senderType)}</span>
          <span>{formatDate(message.createdAt)}</span>
        </div>
        <p className="whitespace-pre-wrap leading-relaxed">{cleanMessage(message.content)}</p>
      </div>
    </div>
  );
}

export default async function SuperAdminChatLogDetailPage({ params }: { params: { id: string } }) {
  const admin = await requireRole([ROLES.SUPER_ADMIN]);
  const chat = await getChatLogDetail(params.id, admin.userId);
  if (!chat) notFound();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link href="/super-admin/chat-logs" className="text-sm text-muted-foreground hover:underline">
          Back to chat logs
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{chat.companyName}</h1>
          <Badge variant="outline">{label(chat.status)}</Badge>
          <Badge variant={auditVariant(chat.qualityStatus)}>{label(chat.qualityStatus)}</Badge>
          {chat.qualityScore == null ? null : <Badge variant="secondary">{chat.qualityScore}% audit</Badge>}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {chat.botName ?? 'No bot'} · {chat.channel.replace(/_/g, ' ')} · visitor {chat.visitorId ?? '-'}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Transcript</CardTitle>
          </CardHeader>
          <CardContent className="max-h-[68vh] space-y-3 overflow-y-auto">
            {chat.messages.length === 0 ? (
              <p className="text-sm text-muted-foreground">No messages saved for this conversation.</p>
            ) : (
              chat.messages.map((message) => <MessageBubble key={message.id} message={message} />)
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Automatic audit</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Status</span>
                <Badge variant={auditVariant(chat.qualityStatus)}>{label(chat.qualityStatus)}</Badge>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Issue</span>
                <span className="text-right">{label(chat.qualityLabel)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Score</span>
                <span>{chat.qualityScore == null ? '-' : `${chat.qualityScore}%`}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Last activity</span>
                <span className="text-right">{formatDate(chat.lastMessageAt)}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Answer reviews</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {chat.qualityLogs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No AI answer quality logs yet.</p>
              ) : (
                chat.qualityLogs.map((log) => (
                  <div key={log.id} className="space-y-2 rounded-md border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={auditVariant(log.autoAuditStatus)}>{label(log.autoAuditStatus)}</Badge>
                      {log.autoAuditScore == null ? null : <span className="text-xs text-muted-foreground">{log.autoAuditScore}%</span>}
                    </div>
                    <p className="font-medium">{log.question}</p>
                    {log.autoAuditReason ? <p className="text-muted-foreground">{log.autoAuditReason}</p> : null}
                    {log.suggestedFix ? (
                      <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-950">
                        {log.suggestedFix}
                      </div>
                    ) : null}
                    <div className="text-xs text-muted-foreground">
                      {log.model ?? 'model unknown'} · {log.latencyMs == null ? '-' : `${log.latencyMs}ms`} · {formatDate(log.createdAt)}
                    </div>
                    <Link href={`/super-admin/companies/${chat.companyId}?tab=quality`} className="text-xs text-primary hover:underline">
                      Open company quality fixes
                    </Link>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
