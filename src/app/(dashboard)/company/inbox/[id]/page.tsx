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

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <InboxRealtime conversationId={convo.id} />

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
          <AgentReplyForm conversationId={convo.id} />
        </CardContent>
      </Card>
    </div>
  );
}
