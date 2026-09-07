'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  ExternalLink,
  LifeBuoy,
  Loader2,
  Play,
  Route,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { companyLabel, humanizeEnum } from '@/lib/labels';
import type { HelpdeskChatSettings } from '@/lib/helpdesk/chat-settings';
import type { ReplyAllowanceUsage } from '@/lib/billing';

type Pill = { id: string; label: string; message: string; source: string; contextMode: string };
type NavigationTarget = {
  label: string;
  routeId: string;
  path: string | null;
  module: string;
  screen: string;
};
type GuidedAction = {
  id: string;
  name: string;
  label: string;
  description: string;
  type: string;
  risk: string;
  requiredFields: string[];
  optionalFields: string[];
  needsConfirmation: boolean;
};

interface ChatResponse {
  answer: string;
  conversationId: string;
  pills: Pill[];
  navigationTargets: NavigationTarget[];
  guidedActions: GuidedAction[];
  uiActions?: Array<{ action: string; payload: unknown }>;
  replyUsage?: PublicReplyUsage;
  shouldSuggestTicket?: boolean;
}

interface Message {
  role: 'staff' | 'assistant';
  text: string;
}

type PublicReplyUsage = Pick<
  ReplyAllowanceUsage,
  'used' | 'monthlyAllowance' | 'extraReplies' | 'totalAvailable' | 'remaining' | 'resetAt'
>;

type TicketPrompt = {
  subject: string;
  details: string;
  severity: 'low' | 'normal' | 'high' | 'urgent';
};
type ConnectorHealthAlert = {
  id: string;
  name: string;
  platform: string;
  state: string;
  message: string;
  lastError: string | null;
};

// Action and field names come from the connected system, so they are never in a
// fixed enum map. `humanizeEnum` is the shared fallback formatter — it replaces
// this file's private `.replace(/_/g, ' ')`, and sentence-cases rather than
// title-casing so "update_stock" reads as "Update stock" mid-sentence.
const title = humanizeEnum;

function formatNumber(value: number | null): string {
  return value == null ? 'Unlimited' : value.toLocaleString();
}

function formatReset(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

function helpdeskEvents(
  actions: ChatResponse['uiActions'],
): Array<{ eventId: string; actionName: string; status: string }> {
  return (actions ?? [])
    .filter(
      (item) =>
        item.action === 'helpdesk_event' && item.payload && typeof item.payload === 'object',
    )
    .map((item) => item.payload as Record<string, unknown>)
    .filter(
      (payload): payload is { eventId: string; actionName: string; status: string } =>
        typeof payload.eventId === 'string' &&
        typeof payload.actionName === 'string' &&
        typeof payload.status === 'string',
    );
}

function issueSubject(text: string): string {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (!clean) return 'Help Desk issue';
  return clean.length > 96 ? `${clean.slice(0, 93)}...` : clean;
}

function shouldOfferTicketFromError(text: string): boolean {
  return /\b(failed|error|hidden|not available|could not|cannot|unable|timeout|stuck|queued)\b/i.test(
    text,
  );
}

export function HelpdeskInternalChat({
  initialPills,
  settings: _settings,
  initialReplyUsage,
  connectorHealthAlerts = [],
}: {
  initialPills: string[];
  settings: HelpdeskChatSettings;
  initialReplyUsage: PublicReplyUsage;
  connectorHealthAlerts?: ConnectorHealthAlert[];
}) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      text: 'Ask about screens, paths, reports, stock, products, or safe updates.',
    },
  ]);
  const [text, setText] = useState('');
  const [route, setRoute] = useState('dashboard');
  const [loading, setLoading] = useState(false);
  const [last, setLast] = useState<ChatResponse | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [replyUsage, setReplyUsage] = useState<PublicReplyUsage>(initialReplyUsage);
  const [activeAction, setActiveAction] = useState<GuidedAction | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [actionConfirmed, setActionConfirmed] = useState(false);
  const [lastQuestion, setLastQuestion] = useState('');
  const [ticketPrompt, setTicketPrompt] = useState<TicketPrompt | null>(null);
  const [ticketLoading, setTicketLoading] = useState(false);
  const [ticketHref, setTicketHref] = useState<string | null>(null);

  const visiblePills = useMemo(() => {
    if (last?.pills?.length) return last.pills;
    return initialPills.slice(0, 6).map((label, index) => ({
      id: `initial-${index}`,
      label,
      message: label,
      source: 'default',
      contextMode: 'initial',
    }));
  }, [initialPills, last?.pills]);

  async function ask(message: string) {
    const clean = message.trim();
    if (!clean || loading) return;
    setLoading(true);
    setText('');
    setLastQuestion(clean);
    setTicketHref(null);
    setTicketPrompt(null);
    setMessages((current) => [...current, { role: 'staff', text: clean }]);
    try {
      const res = await fetch('/api/helpdesk/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: clean, currentRoute: route }),
      });
      const data = await res.json();
      if (data.replyUsage) setReplyUsage(data.replyUsage);
      if (!res.ok) {
        if (
          data.error === 'helpdesk_chat_not_available_here' ||
          data.error === 'helpdesk_chat_hidden_by_visibility_rules'
        ) {
          throw new Error(
            `Help Desk is hidden on "${route}" by visibility settings. Leave route targeting empty to show it everywhere, or remove this route from blocked routes.`,
          );
        }
        throw new Error(data.message ?? data.error ?? 'Help Desk chat failed.');
      }
      setLast(data);
      if (data.conversationId) setConversationId(data.conversationId);
      if (data.replyUsage) setReplyUsage(data.replyUsage);
      setMessages((current) => [
        ...current,
        { role: 'assistant', text: data.answer || 'No answer.' },
      ]);
      if (data.shouldSuggestTicket) {
        setTicketPrompt({
          subject: issueSubject(clean),
          severity: shouldOfferTicketFromError(data.answer ?? '') ? 'high' : 'normal',
          details: [
            `Staff question: ${clean}`,
            '',
            `Assistant answer: ${data.answer || 'No answer.'}`,
          ].join('\n'),
        });
      }
      followQueuedEvents(helpdeskEvents(data.uiActions));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Help Desk chat failed.';
      setMessages((current) => [...current, { role: 'assistant', text: message }]);
      setTicketPrompt({
        subject: issueSubject(clean || 'Help Desk chat failed'),
        severity: 'high',
        details: [`Staff question: ${clean}`, '', `Error: ${message}`].join('\n'),
      });
    } finally {
      setLoading(false);
    }
  }

  function followQueuedEvents(
    events: Array<{ eventId: string; actionName: string; status: string }>,
  ) {
    for (const event of events) {
      if (!['queued', 'running'].includes(event.status)) continue;
      void pollEventResult(event);
    }
  }

  async function pollEventResult(event: { eventId: string; actionName: string }) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 120_000) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      try {
        const res = await fetch(`/api/helpdesk/events/${event.eventId}`, { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message ?? data.error ?? 'Could not check the result.');
        if (['completed', 'failed', 'cancelled'].includes(String(data.status))) {
          const text = String(data.displayText ?? `${title(event.actionName)} ${data.status}.`);
          setMessages((current) => [...current, { role: 'assistant', text }]);
          if (String(data.status) !== 'completed') {
            setTicketPrompt({
              subject: `${title(event.actionName)} ${data.status}`,
              severity: 'high',
              details: [
                `Connector action: ${event.actionName}`,
                `Event id: ${event.eventId}`,
                `Status: ${data.status}`,
                '',
                text,
              ].join('\n'),
            });
          }
          return;
        }
      } catch (error) {
        setMessages((current) => [
          ...current,
          {
            role: 'assistant',
            text:
              error instanceof Error
                ? error.message
                : `Could not check ${title(event.actionName)} result.`,
          },
        ]);
        return;
      }
    }
    setMessages((current) => [
      ...current,
      {
        role: 'assistant',
        text: `${title(event.actionName)} is still running. Check the Help Desk logs for the result.`,
      },
    ]);
    setTicketPrompt({
      subject: `${title(event.actionName)} still running`,
      severity: 'normal',
      details: [
        `Connector action: ${event.actionName}`,
        `Event id: ${event.eventId}`,
        '',
        'This did not finish within two minutes.',
      ].join('\n'),
    });
  }

  async function createTicket() {
    const prompt = ticketPrompt ?? {
      subject: issueSubject(lastQuestion || 'Help Desk issue'),
      severity: 'normal' as const,
      details: `Staff question: ${lastQuestion || 'No question captured.'}`,
    };
    setTicketLoading(true);
    try {
      const res = await fetch('/api/helpdesk/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          currentRoute: route,
          ...prompt,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? 'Could not create ticket.');
      setConversationId(data.conversationId ?? conversationId);
      setTicketHref(data.inboxHref ?? `/company/inbox/${data.conversationId}`);
      setTicketPrompt(null);
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          text: 'Support ticket created. Company admins and agents can now handle it from the inbox.',
        },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          text: error instanceof Error ? error.message : 'Could not create ticket.',
        },
      ]);
    } finally {
      setTicketLoading(false);
    }
  }

  function submitGuidedAction() {
    if (!activeAction) return;
    if (activeAction.needsConfirmation && !actionConfirmed) return;
    const fields = [...activeAction.requiredFields, ...activeAction.optionalFields];
    const details = fields
      .map((field) => `${field}: ${formValues[field] ?? ''}`)
      .filter((line) => !line.endsWith(': '))
      .join(', ');
    const confirmText = activeAction.needsConfirmation ? ', confirmed: true' : '';
    void ask(`Run ${activeAction.name} with ${details}${confirmText}`);
    setActiveAction(null);
    setFormValues({});
    setActionConfirmed(false);
  }

  return (
    <div className="rounded-lg border bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b p-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="font-semibold">Ask the Help Desk</h2>
          <p className="text-sm text-muted-foreground">
            Only your team can see this. It appears on every staff screen unless you hide it.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs">
            <span className="font-semibold">{formatNumber(replyUsage.remaining)}</span>{' '}
            <span className="text-muted-foreground">replies left</span>
            <span className="ms-2 text-muted-foreground">
              {formatNumber(replyUsage.used)} / {formatNumber(replyUsage.totalAvailable)}
            </span>
            <span className="ms-2 text-muted-foreground">
              resets {formatReset(replyUsage.resetAt)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Route className="h-4 w-4 text-muted-foreground" />
            {/* An icon is not a label. This box had neither one nor a
                placeholder, so it announced as an unnamed text field and gave a
                sighted user nothing either. */}
            <Input
              aria-label="Which screen you are pretending to be on"
              title="Which screen you are pretending to be on"
              value={route}
              onChange={(event) => setRoute(event.target.value)}
              placeholder="/orders"
              className="h-9 w-48"
            />
          </div>
        </div>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_320px] [&>*]:min-w-0">
        <div className="space-y-4">
          {connectorHealthAlerts.length ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4" />
                Trouble reaching your shop system
              </div>
              <div className="mt-2 space-y-2">
                {connectorHealthAlerts.slice(0, 3).map((alert) => (
                  <div
                    key={alert.id}
                    className="rounded-md border border-amber-200 bg-white/60 p-2"
                  >
                    <p className="font-medium">
                      {alert.name}: {alert.message}
                    </p>
                    <p className="text-xs text-amber-900">
                      {companyLabel('connectionState', alert.state)}. Anything your team asks for
                      may sit waiting until this is back online.
                    </p>
                    {alert.lastError ? (
                      <p className="mt-1 text-xs text-destructive">{alert.lastError}</p>
                    ) : null}
                  </div>
                ))}
                {connectorHealthAlerts.length > 3 ? (
                  <p className="text-xs text-amber-900">
                    {connectorHealthAlerts.length - 3} more connector warning(s) hidden.
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
          <div className="rounded-md border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
            Test route: <span className="font-mono text-foreground">{route}</span>. Leave route
            targeting empty to allow all staff screens, then block only screens like login or
            checkout.
          </div>
          <div className="h-[420px] overflow-y-auto rounded-md border bg-slate-50 p-3">
            <div className="space-y-3">
              {messages.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  /* Module 21 (RTL): `ms-auto`/`me-auto`, not `ml-`/`mr-`. Chat
                     bubbles carry meaning by which side they sit on — "mine" vs
                     "theirs" — so under Arabic the physical properties would pin
                     both roles to the wrong edges and swap who is speaking. */
                  className={
                    message.role === 'staff'
                      ? 'ms-auto max-w-[82%] rounded-md bg-primary p-3 text-sm text-primary-foreground'
                      : 'me-auto max-w-[88%] rounded-md bg-white p-3 text-sm leading-6 shadow-sm'
                  }
                >
                  {message.text}
                </div>
              ))}
              {loading ? (
                <div className="me-auto inline-flex items-center gap-2 rounded-md bg-white p-3 text-sm text-muted-foreground shadow-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Looking it up
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {ticketPrompt ? (
              <button
                type="button"
                onClick={createTicket}
                disabled={ticketLoading}
                className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-950 hover:bg-amber-100 disabled:opacity-60"
              >
                {ticketLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <LifeBuoy className="h-3.5 w-3.5" />
                )}
                Create support ticket
              </button>
            ) : null}
            {ticketHref ? (
              <a
                href={ticketHref}
                className="inline-flex items-center gap-1 rounded-full border bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-900 hover:bg-emerald-100"
              >
                <LifeBuoy className="h-3.5 w-3.5" />
                Open ticket
              </a>
            ) : null}
            {visiblePills.length === 0 && !ticketPrompt && !ticketHref ? (
              <p className="text-xs text-muted-foreground">
                No suggested questions yet. Type a question below and related ones appear here.
              </p>
            ) : null}
            {visiblePills.map((pill) => (
              <button
                key={pill.id}
                type="button"
                onClick={() => ask(pill.message)}
                className="inline-flex items-center gap-1 rounded-full border bg-white px-3 py-1.5 text-xs font-medium hover:bg-muted"
              >
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                {pill.label}
              </button>
            ))}
          </div>

          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void ask(text);
            }}
          >
            {/* Placeholder-as-label. A visible label would break the composer
                mock, so this is the one place `aria-label` is the right answer
                rather than the lazy one. */}
            <Input
              aria-label="Ask the staff help desk"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Ask staff helpdesk..."
            />
            <Button type="submit" disabled={loading} size="icon" aria-label="Ask">
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowRight className="h-4 w-4" />
              )}
            </Button>
          </form>
        </div>

        <aside className="space-y-4">
          <div className="rounded-md border p-3">
            <div className="mb-2 text-sm font-semibold">Go to a screen</div>
            <div className="space-y-2">
              {(last?.navigationTargets ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Buttons appear here once your shop system tells us which screens it has.
                </p>
              ) : (
                last!.navigationTargets.map((target) => (
                  <button
                    key={target.routeId}
                    type="button"
                    onClick={() => ask(`Open ${target.screen}`)}
                    className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-start text-xs hover:bg-muted"
                    title={target.routeId}
                  >
                    <span>
                      <span className="block font-medium">{target.label}</span>
                      <span className="text-muted-foreground">{target.path ?? target.routeId}</span>
                    </span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="rounded-md border p-3">
            <div className="mb-2 text-sm font-semibold">Things it can do for you</div>
            <div className="space-y-2">
              {(last?.guidedActions ?? []).slice(0, 6).map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => {
                    setActiveAction(action);
                    setActionConfirmed(false);
                  }}
                  className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-start text-xs hover:bg-muted"
                >
                  <span>
                    <span className="block font-medium">{action.label}</span>
                    <span className="text-muted-foreground">
                      {companyLabel('actionRisk', action.risk)}
                    </span>
                  </span>
                  <Play className="h-3.5 w-3.5" />
                </button>
              ))}
              {(last?.guidedActions ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Ask a question first, and the tasks you have approved appear here.
                </p>
              ) : null}
            </div>
          </div>

          {activeAction ? (
            <div className="rounded-md border border-primary/40 bg-primary/5 p-3">
              <div className="font-semibold">{activeAction.label}</div>
              <p className="mt-1 text-xs text-muted-foreground">{activeAction.description}</p>
              <div className="mt-3 space-y-2">
                {[...activeAction.requiredFields, ...activeAction.optionalFields].map((field) => (
                  /* The field name lived only in the placeholder, so it
                     vanished the moment anyone typed and was never announced;
                     the required marker was a bare "*" with no `required`
                     behind it. Both are now real attributes. */
                  <Input
                    key={field}
                    aria-label={`${title(field)}${
                      activeAction.requiredFields.includes(field) ? ' (required)' : ' (optional)'
                    }`}
                    required={activeAction.requiredFields.includes(field)}
                    placeholder={`${title(field)}${activeAction.requiredFields.includes(field) ? ' *' : ''}`}
                    value={formValues[field] ?? ''}
                    onChange={(event) =>
                      setFormValues((current) => ({ ...current, [field]: event.target.value }))
                    }
                  />
                ))}
              </div>
              {activeAction.needsConfirmation ? (
                <label className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950">
                  <input
                    type="checkbox"
                    checked={actionConfirmed}
                    onChange={(event) => setActionConfirmed(event.target.checked)}
                    className="mt-0.5 h-4 w-4"
                  />
                  I understand this changes real data in your shop system.
                </label>
              ) : null}
              <div className="mt-3 flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={submitGuidedAction}
                  disabled={activeAction.needsConfirmation && !actionConfirmed}
                >
                  {activeAction.needsConfirmation ? 'Confirm and run' : 'Run'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setActiveAction(null);
                    setActionConfirmed(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
