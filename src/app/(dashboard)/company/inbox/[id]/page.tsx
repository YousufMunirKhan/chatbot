import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { getConversationDetail, type InboxMessage } from '@/modules/company/inbox-data';
import { AgentReplyForm } from '@/modules/company/components/agent-reply-form';
import { AiControls } from '@/modules/company/components/ai-controls';
import { InboxRealtime } from '@/modules/company/components/inbox-realtime';
import { ChatAutoScroll } from '@/modules/company/components/chat-auto-scroll';
import { TicketPanel } from '@/modules/company/components/ticket-panel';
import { ConversationPresence } from '@/modules/company/components/conversation-presence';

type BadgeVariant = 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline';

function statusVariant(status: string): BadgeVariant {
  if (status === 'ai_active') return 'secondary';
  if (status === 'needs_human') return 'warning';
  if (status === 'human_active') return 'warning';
  if (status === 'closed') return 'outline';
  return 'outline';
}

function displayStatus(status: string, aiEnabled: boolean): string {
  if (status === 'closed' || status === 'expired' || status === 'needs_human') return status;
  return aiEnabled ? 'ai_active' : 'human_active';
}

function statusLabel(status: string): string {
  if (status === 'ai_active') return 'AI active';
  return status
    .replace(/_/g, ' ')
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

function senderLabel(senderType: string): string {
  if (senderType === 'ai') return 'AI';
  if (senderType === 'agent') return 'Agent';
  if (senderType === 'system') return 'System';
  return 'Visitor';
}

function displayMessage(content: string): string {
  return content
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*---+\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function MessageBubble({ message }: { message: InboxMessage }) {
  const { senderType } = message;

  if (senderType === 'system') {
    return (
      <div className="flex justify-center">
        <div className="max-w-[80%] rounded-full bg-muted px-3 py-1 text-center text-xs text-muted-foreground">
          {message.content}
        </div>
      </div>
    );
  }

  const isAgent = senderType === 'agent';
  return (
    <div className={cn('flex', isAgent ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[80%] rounded-lg px-3 py-2 text-sm',
          senderType === 'visitor' && 'bg-muted',
          senderType === 'ai' && 'bg-blue-50 text-blue-900',
          senderType === 'agent' && 'bg-primary/10',
        )}
      >
        <p className="mb-0.5 text-xs font-medium text-muted-foreground">{senderLabel(senderType)}</p>
        <p className="whitespace-pre-wrap leading-relaxed">{displayMessage(message.content)}</p>
      </div>
    </div>
  );
}

export default async function ConversationPage({ params }: { params: { id: string } }) {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const convo = await getConversationDetail(params.id);
  if (!convo) notFound();

  const visitorName = convo.visitorId
    ? convo.visitorId.length > 8
      ? convo.visitorId.slice(0, 8)
      : convo.visitorId
    : 'Visitor';
  const status = displayStatus(convo.status, convo.aiEnabled);
  const priorityVariant: BadgeVariant =
    convo.priority === 'urgent' ? 'destructive' : convo.priority === 'high' ? 'warning' : 'outline';

  return (
    <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-6">
        <InboxRealtime conversationId={convo.id} />
        <ConversationPresence conversationId={convo.id} />

        <div>
          <Link href="/company/inbox" className="text-sm text-muted-foreground hover:underline">
            ← Inbox
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">{visitorName}</h1>
            <Badge variant={statusVariant(status)}>{statusLabel(status)}</Badge>
            <Badge variant={convo.aiEnabled ? 'success' : 'outline'}>
              {convo.aiEnabled ? 'AI on' : 'AI off'}
            </Badge>
            {convo.priority !== 'normal' ? (
              <Badge variant={priorityVariant} className="capitalize">{convo.priority}</Badge>
            ) : null}
            {convo.csatRating ? (
              <Badge variant="secondary">{convo.csatRating}★ CSAT</Badge>
            ) : null}
          </div>
        </div>

        <Card>
          <CardContent className="max-h-[55vh] space-y-3 overflow-y-auto p-4">
            {convo.messages.length === 0 ? (
              <p className="text-sm text-muted-foreground">No messages yet.</p>
            ) : (
              convo.messages.map((m) => <MessageBubble key={m.id} message={m} />)
            )}
            <ChatAutoScroll count={convo.messages.length} />
          </CardContent>
        </Card>

        <AiControls conversationId={convo.id} aiEnabled={convo.aiEnabled} isClosed={convo.status === 'closed'} />

        <Card>
          <CardContent className="p-4">
            <AgentReplyForm conversationId={convo.id} cannedResponses={convo.cannedResponses} />
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        {convo.csatComment ? (
          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">CSAT feedback</p>
              <p className="mt-1 text-sm">“{convo.csatComment}”</p>
            </CardContent>
          </Card>
        ) : null}
        <Card>
          <CardContent className="p-4">
            <TicketPanel
              conversationId={convo.id}
              priority={convo.priority}
              tags={convo.tags}
              notes={convo.notes}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
