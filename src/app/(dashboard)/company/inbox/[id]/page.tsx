import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatAbsoluteTime, formatRelativeTime } from '@/lib/relative-time';
import {
  conversationDisplayName,
  conversationSource,
  conversationTicketNumber,
  DEFAULT_MESSAGE_WINDOW,
  getConversationDetail,
  type ConversationDetail,
  type InboxMessage,
} from '@/modules/company/inbox-data';
import { AgentReplyForm } from '@/modules/company/components/agent-reply-form';
import { ConversationAiToggle } from '@/modules/company/components/conversation-ai-toggle';
import { InboxRealtime } from '@/modules/company/components/inbox-realtime';
import { ChatAutoScroll } from '@/modules/company/components/chat-auto-scroll';
import { TicketPanel } from '@/modules/company/components/ticket-panel';
import { ConversationPresence } from '@/modules/company/components/conversation-presence';

/**
 * One conversation.
 *
 * What changed and why:
 *  - Every bubble carries a timestamp. Without one an agent could not tell
 *    whether the last message arrived four minutes or four days ago, which was
 *    the worst defect on this screen.
 *  - The composer is pinned and the transcript scrolls. It used to be a
 *    `max-h-[55vh]` box inside a scrolling page, so replying meant scrolling the
 *    page away from the messages you were replying to.
 *  - The header carries two badges instead of nine, and the AI control is a real
 *    labelled switch rather than two alternating buttons plus a duplicate badge.
 *  - `TicketTimeline` is gone. It restated the transcript, restated the notes,
 *    and printed each entry's title twice — once as text and again as a badge
 *    containing the same text. Genuine system events already render inline in
 *    the transcript as centred pills, which is where they belong.
 *  - Raw enums are never printed: `needs_human` reads "Waiting for you",
 *    `closed` reads "Sorted", `expired` reads "Went quiet".
 */

type BadgeVariant = 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline';
type Chip = { label: string; variant: BadgeVariant };

function statusChip(convo: ConversationDetail): Chip | null {
  if (convo.status === 'needs_human') return { label: 'Waiting for you', variant: 'warning' };
  if (convo.status === 'closed') return { label: 'Sorted', variant: 'outline' };
  if (convo.status === 'expired') return { label: 'Went quiet', variant: 'outline' };
  if (convo.status === 'human_active') return { label: 'A person is on it', variant: 'secondary' };
  // `ai_active` is the default state. The switch already says so.
  return null;
}

/** At most one exception, so the header never exceeds two badges. */
function exceptionChip(convo: ConversationDetail): Chip | null {
  if (convo.priority === 'urgent') return { label: 'Urgent', variant: 'destructive' };
  if (conversationSource(convo) === 'connector') return { label: 'Connector problem', variant: 'destructive' };
  if (typeof convo.csatRating === 'number' && convo.csatRating <= 2) {
    return { label: `Rated ${convo.csatRating}/5`, variant: 'destructive' };
  }
  return null;
}

function senderLabel(senderType: string): string {
  if (senderType === 'ai') return 'Assistant';
  if (senderType === 'agent') return 'Your team';
  return 'Customer';
}

function displayMessage(content: string): string {
  return content
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*---+\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Centred pill used for both system messages and the closing divider. */
function SystemDivider({ text, at, now }: { text: string; at: string | null; now: Date }) {
  return (
    <div className="flex justify-center">
      <div className="max-w-[80%] rounded-full bg-muted px-3 py-1 text-center text-xs text-muted-foreground">
        {text}
        {at ? (
          <>
            {' · '}
            <time dateTime={at} title={formatAbsoluteTime(at)}>
              {formatRelativeTime(at, now)}
            </time>
          </>
        ) : null}
      </div>
    </div>
  );
}

function MessageBubble({ message, now }: { message: InboxMessage; now: Date }) {
  const { senderType } = message;

  if (senderType === 'system') {
    return <SystemDivider text={message.content} at={message.createdAt} now={now} />;
  }

  const isAgent = senderType === 'agent';
  return (
    <div className={cn('flex', isAgent ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[80%] rounded-lg px-3 py-2 text-sm',
          senderType === 'visitor' && 'bg-muted',
          senderType === 'ai' && 'bg-info-bg text-info-fg',
          senderType === 'agent' && 'bg-primary/10',
        )}
      >
        <p className="mb-0.5 flex items-baseline gap-2 text-xs text-muted-foreground">
          <span className="font-medium">{senderLabel(senderType)}</span>
          <time dateTime={message.createdAt} title={formatAbsoluteTime(message.createdAt)}>
            {formatRelativeTime(message.createdAt, now)}
          </time>
        </p>
        <p className="whitespace-pre-wrap leading-relaxed">{displayMessage(message.content)}</p>
      </div>
    </div>
  );
}

export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { msgs?: string };
}) {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const messageLimit = Number(searchParams?.msgs) || DEFAULT_MESSAGE_WINDOW;
  const convo = await getConversationDetail(params.id, { messageLimit });
  if (!convo) notFound();

  const now = new Date();
  const { label: name, suffix } = conversationDisplayName(convo);
  const chips = [statusChip(convo), exceptionChip(convo)].filter((chip): chip is Chip => chip !== null);
  const ticketNumber = conversationTicketNumber(convo);
  const contactLine = [convo.leadName ? convo.leadContact : null, convo.assignedAgentName ? `Assigned to ${convo.assignedAgentName}` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      {/* The conversation column owns the viewport height on desktop: the header
          and composer are fixed rows, and only the transcript scrolls. */}
      <div className="flex min-w-0 flex-col gap-4 lg:h-[calc(100vh-7.5rem)]">
        <InboxRealtime conversationId={convo.id} />
        <ConversationPresence conversationId={convo.id} />

        <div>
          <Link href="/company/inbox" className="text-sm text-muted-foreground hover:underline">
            <span className="dir-arrow" aria-hidden="true">
              &larr;
            </span>{' '}
            Inbox
          </Link>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold">
                  {name}
                  {suffix ? <span className="font-normal text-muted-foreground"> · {suffix}</span> : null}
                </h1>
                {chips.map((chip) => (
                  <Badge key={chip.label} variant={chip.variant}>
                    {chip.label}
                  </Badge>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {ticketNumber}
                {contactLine ? ` · ${contactLine}` : ''}
                {convo.startedAt ? ` · started ${formatRelativeTime(convo.startedAt, now)}` : ''}
              </p>
            </div>
            <ConversationAiToggle
              key={convo.id}
              conversationId={convo.id}
              aiEnabled={convo.aiEnabled}
              isClosed={convo.status === 'closed'}
            />
          </div>
        </div>

        <Card className="flex min-h-0 flex-1 flex-col">
          <CardContent className="max-h-[60vh] flex-1 space-y-3 overflow-y-auto p-4 lg:max-h-none">
            {convo.hasEarlierMessages ? (
              <div className="flex justify-center">
                <Link
                  href={`/company/inbox/${convo.id}?msgs=${convo.messages.length + 100}`}
                  className="rounded-full border px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
                >
                  Load earlier messages ({convo.totalMessages - convo.messages.length} more)
                </Link>
              </div>
            ) : null}
            {convo.messages.length === 0 ? (
              <p className="text-sm text-muted-foreground">No messages yet.</p>
            ) : (
              convo.messages.map((m) => <MessageBubble key={m.id} message={m} now={now} />)
            )}
            {convo.status === 'closed' && convo.closedAt ? (
              <SystemDivider text="Marked as sorted" at={convo.closedAt} now={now} />
            ) : null}
            <ChatAutoScroll count={convo.messages.length} />
          </CardContent>
        </Card>

        {/* Pinned composer — outside the scroll area, so it never moves.
            On a phone the column has no fixed height, so it also sticks to the
            bottom of the viewport: at 375x812 the reply box rendered at y=912,
            which is to say an agent opened a chat on their phone and could not
            see where to type. */}
        <Card className="sticky bottom-0 z-10 shrink-0 shadow-lg lg:static lg:shadow-none">
          <CardContent className="p-4">
            <AgentReplyForm key={convo.id} conversationId={convo.id} cannedResponses={convo.cannedResponses} />
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        {convo.csatComment ? (
          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                What the customer said
              </p>
              <p className="mt-1 text-sm">{convo.csatComment}</p>
            </CardContent>
          </Card>
        ) : null}
        <Card>
          <CardContent className="p-4">
            <TicketPanel
              key={convo.id}
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
