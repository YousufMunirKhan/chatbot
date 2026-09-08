import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
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
import { ConversationAssign } from '@/modules/company/components/conversation-assign';
import { ConversationSnooze } from '@/modules/company/components/conversation-snooze';
import { InboxRealtime } from '@/modules/company/components/inbox-realtime';
import { ChatAutoScroll } from '@/modules/company/components/chat-auto-scroll';
import { TicketPanel } from '@/modules/company/components/ticket-panel';
import { ConversationPresence } from '@/modules/company/components/conversation-presence';
import { timeUntilLabel } from '@/modules/company/components/inbox-snooze-presets';

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

function statusChip(convo: ConversationDetail, now: Date): Chip | null {
  // A live snooze outranks the status. The conversation may well still be
  // "waiting for you", but not until Tuesday, and that is the fact that decides
  // whether the reader does anything about it now.
  if (convo.snoozedUntil && new Date(convo.snoozedUntil).getTime() > now.getTime()) {
    return { label: `Snoozed · back in ${timeUntilLabel(convo.snoozedUntil, now)}`, variant: 'secondary' };
  }
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
        {/* `break-words`: a customer pasting a long tracking URL or an order
            reference with no spaces in it pushed the bubble past its 80% cap
            and, in the sticky-composer layout, out of the card entirely. */}
        <p className="whitespace-pre-wrap break-words leading-relaxed">
          {displayMessage(message.content)}
        </p>
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
  const session = await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const messageLimit = Number(searchParams?.msgs) || DEFAULT_MESSAGE_WINDOW;
  const convo = await getConversationDetail(params.id, { messageLimit });
  if (!convo) notFound();

  const now = new Date();
  const { label: name, suffix } = conversationDisplayName(convo);
  const chips = [statusChip(convo, now), exceptionChip(convo)].filter((chip): chip is Chip => chip !== null);
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

        {/* The way back to the list, in the one component every other drill-down
            page in the app uses for it. It was hand-written here, which is how
            this page ended up with the back-link convention `PageHeader` was
            built to retire — a bare arrow above a bespoke title row. */}
        <PageHeader
          backTo={{ href: '/company/inbox', label: 'Inbox' }}
          title={
            <span className="flex flex-wrap items-center gap-2">
              {name}
              {suffix ? <span className="font-normal text-muted-foreground">· {suffix}</span> : null}
              {chips.map((chip) => (
                <Badge key={chip.label} variant={chip.variant}>
                  {chip.label}
                </Badge>
              ))}
            </span>
          }
          description={`${ticketNumber}${contactLine ? ` · ${contactLine}` : ''}${
            convo.startedAt ? ` · started ${formatRelativeTime(convo.startedAt, now)}` : ''
          }`}
          actions={
            <ConversationAiToggle
              key={convo.id}
              conversationId={convo.id}
              aiEnabled={convo.aiEnabled}
              isClosed={convo.status === 'closed'}
            />
          }
        />

        <Card className="flex min-h-0 flex-1 flex-col">
          <CardContent className="max-h-[60vh] flex-1 space-y-3 overflow-y-auto p-4 lg:max-h-none">
            {convo.hasEarlierMessages ? (
              <div className="flex justify-center">
                {/* The `Button` primitive rather than a hand-rolled pill: this
                    was the only control in the product wearing `rounded-full`
                    with a border, and it sat two sizes below every other
                    control on the screen. */}
                <Button asChild size="sm" variant="outline">
                  <Link href={`/company/inbox/${convo.id}?msgs=${convo.messages.length + 100}`}>
                    Load earlier messages ({convo.totalMessages - convo.messages.length} more)
                  </Link>
                </Button>
              </div>
            ) : null}
            {convo.messages.length === 0 ? (
              // A designed state, not a stray sentence: an empty transcript is
              // real — a visitor who opened the chat and typed nothing.
              <EmptyState
                title="Nothing has been said yet"
                body="This chat was opened but no message was sent. Anything either side writes will appear here."
              />
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
              {/* The comment came with a score and the panel never showed it,
                  so an agent read "the coffee was cold" with no idea whether
                  the chat had been marked 1 or 4. The header carries the score
                  only when it is bad enough to be an exception; here it is
                  context for the words underneath. */}
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {typeof convo.csatRating === 'number'
                  ? `They rated this chat ${convo.csatRating} out of 5`
                  : 'What the customer said'}
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm">{convo.csatComment}</p>
            </CardContent>
          </Card>
        ) : null}
        {/* Who has it and when it is due back, above the ticket panel: both
            answer "is anyone dealing with this", which is the first question
            asked on opening a conversation someone else was in. */}
        <Card>
          <CardContent className="space-y-4 p-4">
            <ConversationAssign
              key={`assign-${convo.id}`}
              conversationId={convo.id}
              members={convo.assignableMembers}
              currentUserId={session.userId}
              assignedAgentId={convo.assignedAgentId}
              assignedAgentName={convo.assignedAgentName}
              assignedByName={convo.assignedByName}
              assignedAt={convo.assignedAt}
            />
            <ConversationSnooze
              key={`snooze-${convo.id}`}
              conversationId={convo.id}
              snoozedUntil={convo.snoozedUntil}
              snoozedByName={convo.snoozedByName}
            />
          </CardContent>
        </Card>
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
