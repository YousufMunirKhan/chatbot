'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * The mobile embed's chat surface.
 *
 * Not a variant of the website widget: the widget is a bubble that opens a
 * window on someone else's page, and this is the whole screen inside someone
 * else's app. So there is no launcher, no positioning, no z-index war — just a
 * header, a transcript, and a composer that behaves on a phone keyboard.
 *
 * It speaks exactly the same `/api/chat` SSE contract the widget does
 * (`meta` → `status`/`token`/`blocks`/`action` → `human` → `done`) and the same
 * `/api/chat/realtime` stream for agent replies, so a conversation started in
 * the app is the same conversation an agent sees in the inbox.
 */

interface OutboundButton {
  label: string;
  value?: string;
  url?: string;
}

type OutboundBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string; caption?: string }
  | { type: 'video'; url: string; caption?: string }
  | { type: 'file'; url: string; name?: string }
  | { type: 'buttons'; text: string; buttons: OutboundButton[] }
  | { type: 'quick_replies'; text: string; options: OutboundButton[] }
  | { type: 'gallery'; items: Array<{ title: string; subtitle?: string; imageUrl?: string; buttons?: OutboundButton[] }> };

type Role = 'visitor' | 'bot' | 'system';

interface Bubble {
  id: string;
  role: Role;
  text: string;
  buttons?: OutboundButton[];
}

export interface EmbedChatProps {
  publicBotId: string;
  title: string;
  welcomeMessage: string;
  primaryColor: string;
  agentLabel: string;
  footerNote: string;
  /** Server-verified. 'verified' means the host app's signature checked out. */
  identityStatus: string;
  /** Present only for a verified user; otherwise the page generates one. */
  visitorId: string | null;
  displayName: string | null;
  direction: 'ltr' | 'rtl';
  /** Whether to show a close control at all — a host with its own nav bar may not want one. */
  showClose: boolean;
}

interface ChatBridgeApi {
  ready: (botId: string, identity: string) => boolean;
  onConversationStarted: (conversationId: string, botId: string) => boolean;
  onUnreadCountChanged: (count: number) => boolean;
  onHumanRequested: (conversationId: string | null) => boolean;
  onClosePressed: () => boolean;
  onError: (code: string, message: string) => boolean;
  subscribe: (listener: (event: { type: string; user?: Record<string, unknown> | null }) => void) => () => void;
}

function bridge(): ChatBridgeApi | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { ChatBridge?: ChatBridgeApi }).ChatBridge ?? null;
}

const VISITOR_KEY = 'chat-embed:visitor-id';

function localVisitorId(): string {
  try {
    const existing = window.localStorage.getItem(VISITOR_KEY);
    if (existing) return existing;
    const fresh = `web-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    window.localStorage.setItem(VISITOR_KEY, fresh);
    return fresh;
  } catch {
    // WebViews with storage disabled still get a working (per-session) id.
    return `web-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  }
}

function blockToBubble(block: OutboundBlock, id: string): Bubble | null {
  switch (block.type) {
    case 'text':
      return { id, role: 'bot', text: block.text };
    case 'image':
      return { id, role: 'bot', text: block.caption ? `${block.caption}\n${block.url}` : block.url };
    case 'video':
      return { id, role: 'bot', text: block.caption ? `${block.caption}\n${block.url}` : block.url };
    case 'file':
      return { id, role: 'bot', text: block.name ? `${block.name}: ${block.url}` : block.url };
    case 'buttons':
      return { id, role: 'bot', text: block.text, buttons: block.buttons };
    case 'quick_replies':
      return { id, role: 'bot', text: block.text, buttons: block.options };
    case 'gallery':
      return {
        id,
        role: 'bot',
        text: block.items.map((item) => [item.title, item.subtitle].filter(Boolean).join(' — ')).join('\n'),
        buttons: block.items.flatMap((item) => item.buttons ?? []),
      };
    default:
      return null;
  }
}

export function EmbedChat(props: EmbedChatProps) {
  const [messages, setMessages] = useState<Bubble[]>([
    { id: 'welcome', role: 'bot', text: props.welcomeMessage },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [humanActive, setHumanActive] = useState(false);
  // Mirrored in a ref because the SSE handlers read it synchronously, and in
  // state because the realtime effect must re-run the moment it first exists.
  const [conversationId, setConversationId] = useState<string | null>(null);

  const conversationIdRef = useRef<string | null>(null);
  const visitorIdRef = useRef<string>(props.visitorId ?? '');
  const streamingIdRef = useRef<string | null>(null);
  const seenIdsRef = useRef<Record<string, true>>({});
  const unreadRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const accent = props.primaryColor;

  useEffect(() => {
    if (!visitorIdRef.current) visitorIdRef.current = localVisitorId();
    // The bridge script is a blocking tag in the document, so it is normally
    // already there. A handful of retries covers a WebView that deferred it;
    // after that we give up quietly rather than polling forever — the chat
    // works perfectly well with no host listening.
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      const api = bridge();
      if (api) api.ready(props.publicBotId, props.identityStatus);
      if (api || attempts >= 20) clearInterval(timer);
    }, 100);
    const api = bridge();
    if (api) {
      api.ready(props.publicBotId, props.identityStatus);
      clearInterval(timer);
    }
    return () => clearInterval(timer);
  }, [props.publicBotId, props.identityStatus]);

  // The host can hand over a signed identity after login. Verification is
  // server-side, so the only correct response is to reload with the new claim.
  useEffect(() => {
    const api = bridge();
    if (!api) return;
    return api.subscribe((event) => {
      if (event.type === 'close') return;
      if (event.type !== 'user') return;
      const user = (event.user ?? {}) as Record<string, string | undefined>;
      const url = new URL(window.location.href);
      for (const key of ['user_id', 'name', 'email', 'phone', 'locale', 'signature']) url.searchParams.delete(key);
      if (user.userId) url.searchParams.set('user_id', user.userId);
      if (user.name) url.searchParams.set('name', user.name);
      if (user.email) url.searchParams.set('email', user.email);
      if (user.phone) url.searchParams.set('phone', user.phone);
      if (user.locale) url.searchParams.set('locale', user.locale);
      if (user.signature) url.searchParams.set('signature', user.signature);
      window.location.replace(url.toString());
    });
  }, []);

  // Unread badge for the host's tab bar: only counts while the chat screen is
  // not actually on screen, and clears the moment it is.
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === 'visible' && unreadRef.current !== 0) {
        unreadRef.current = 0;
        bridge()?.onUnreadCountChanged(0);
      }
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const scrollToEnd = useCallback(() => {
    window.requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  const push = useCallback(
    (bubble: Bubble) => {
      setMessages((prev) => [...prev, bubble]);
      scrollToEnd();
    },
    [scrollToEnd],
  );

  const countUnread = useCallback(() => {
    if (document.visibilityState === 'visible') return;
    unreadRef.current += 1;
    bridge()?.onUnreadCountChanged(unreadRef.current);
  }, []);

  // --- agent replies (SSE) ---------------------------------------------------
  useEffect(() => {
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    function connect() {
      if (closed || !conversationId) return;
      const url =
        `/api/chat/realtime?publicBotId=${encodeURIComponent(props.publicBotId)}` +
        `&conversationId=${encodeURIComponent(conversationId)}` +
        `&visitorId=${encodeURIComponent(visitorIdRef.current)}`;
      source = new EventSource(url);
      source.onmessage = (event) => {
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(event.data) as Record<string, unknown>;
        } catch {
          return;
        }
        if (payload.type === 'message.created' && payload.message) {
          const message = payload.message as { id: string; sender_type: string; content_text?: string };
          if (seenIdsRef.current[message.id]) return;
          seenIdsRef.current[message.id] = true;
          push({
            id: message.id,
            role: message.sender_type === 'system' ? 'system' : 'bot',
            text: message.content_text ?? '',
          });
          countUnread();
        }
        if (payload.type === 'conversation.updated' && payload.status === 'human_active') {
          setHumanActive(true);
        }
      };
      source.onerror = () => {
        source?.close();
        source = null;
        if (!closed) retry = setTimeout(connect, 3000);
      };
    }

    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      source?.close();
    };
  }, [props.publicBotId, push, countUnread, conversationId]);

  const send = useCallback(
    async (text: string) => {
      if (!text.trim() || sending) return;
      setSending(true);
      setStatus(null);
      streamingIdRef.current = null;
      push({ id: `me-${Date.now()}`, role: 'visitor', text });

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            publicBotId: props.publicBotId,
            visitorId: visitorIdRef.current,
            text,
            ...(conversationIdRef.current ? { conversationId: conversationIdRef.current } : {}),
          }),
        });

        if (!res.ok || !res.body) {
          const detail = (await res.json().catch(() => ({}))) as { error?: string };
          const code = detail.error ?? `http_${res.status}`;
          bridge()?.onError(code, 'The assistant could not be reached.');
          push({
            id: `err-${Date.now()}`,
            role: 'system',
            text:
              code === 'rate_limited'
                ? 'Too many messages at once. Please wait a moment and try again.'
                : 'Sorry, something went wrong. Please try again.',
          });
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        for (;;) {
          const { value, done } = await reader.read();
          if (value) buffer += decoder.decode(value, { stream: true });
          let index = buffer.indexOf('\n\n');
          while (index !== -1) {
            handleFrame(buffer.slice(0, index));
            buffer = buffer.slice(index + 2);
            index = buffer.indexOf('\n\n');
          }
          if (done) {
            if (buffer.trim()) handleFrame(buffer);
            break;
          }
        }
      } catch {
        bridge()?.onError('network_error', 'The assistant could not be reached.');
        push({ id: `err-${Date.now()}`, role: 'system', text: 'You appear to be offline. Please try again.' });
      } finally {
        setSending(false);
        setStatus(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.publicBotId, sending, push],
  );

  function handleFrame(frame: string) {
    for (const line of frame.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim();
      if (!raw) continue;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        continue;
      }
      handleEvent(event);
    }
  }

  function handleEvent(event: Record<string, unknown>) {
    switch (event.type) {
      case 'meta': {
        const incoming = typeof event.conversationId === 'string' ? event.conversationId : null;
        if (incoming && incoming !== conversationIdRef.current) {
          conversationIdRef.current = incoming;
          setConversationId(incoming);
          bridge()?.onConversationStarted(incoming, props.publicBotId);
        }
        break;
      }
      case 'status':
        if (!streamingIdRef.current && typeof event.value === 'string') setStatus(event.value);
        break;
      case 'token': {
        setStatus(null);
        const token = typeof event.value === 'string' ? event.value : '';
        if (!streamingIdRef.current) {
          const id = `bot-${Date.now()}`;
          streamingIdRef.current = id;
          push({ id, role: 'bot', text: token });
        } else {
          const id = streamingIdRef.current;
          setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, text: m.text + token } : m)));
          scrollToEnd();
        }
        break;
      }
      case 'blocks': {
        const blocks = Array.isArray(event.blocks) ? (event.blocks as OutboundBlock[]) : [];
        blocks.forEach((block, i) => {
          const bubble = blockToBubble(block, `blk-${Date.now()}-${i}`);
          if (bubble) push(bubble);
        });
        break;
      }
      case 'human':
        setHumanActive(true);
        bridge()?.onHumanRequested(conversationIdRef.current);
        break;
      case 'error':
        push({
          id: `err-${Date.now()}`,
          role: 'system',
          text: typeof event.value === 'string' ? event.value : 'Something went wrong.',
        });
        break;
      case 'done':
        streamingIdRef.current = null;
        setStatus(null);
        break;
      default:
        break;
    }
  }

  const headerSubtitle = useMemo(() => {
    if (humanActive) return `${props.agentLabel} is replying`;
    if (props.displayName) return `Signed in as ${props.displayName}`;
    return 'Usually replies in a moment';
  }, [humanActive, props.agentLabel, props.displayName]);

  return (
    <div
      dir={props.direction}
      className="flex h-[100dvh] w-full flex-col bg-white text-[15px] text-slate-900"
      style={{ ['--embed-accent' as string]: accent }}
    >
      {/* Safe-area padding, not margin: the header's own background must run
          under the notch/status bar rather than leaving a white strip. */}
      <header
        className="flex items-center gap-3 px-4 pb-3 text-white"
        style={{ background: accent, paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{props.title}</p>
          <p className="truncate text-xs opacity-90">{headerSubtitle}</p>
        </div>
        {props.showClose ? (
          <button
            type="button"
            onClick={() => bridge()?.onClosePressed()}
            aria-label="Close chat"
            // 44x44 is the smallest reliable touch target on a phone, and this
            // is the button that closes the chat inside someone's app — it
            // measured 32x40 with padding alone.
            className="-me-2 flex h-11 w-11 items-center justify-center rounded-full text-2xl leading-none opacity-90"
          >
            ×
          </button>
        ) : null}
      </header>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.map((message) => (
          <div key={message.id} className={message.role === 'visitor' ? 'flex justify-end' : 'flex justify-start'}>
            <div
              className={[
                'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5',
                message.role === 'visitor'
                  ? 'text-white'
                  : message.role === 'system'
                    ? 'bg-slate-100 text-xs text-slate-600'
                    : 'bg-slate-100 text-slate-900',
              ].join(' ')}
              style={message.role === 'visitor' ? { background: accent } : undefined}
            >
              {message.text}
              {message.buttons?.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {message.buttons.map((button, i) =>
                    button.url ? (
                      <a
                        key={`${button.label}-${i}`}
                        href={button.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900"
                      >
                        {button.label}
                      </a>
                    ) : (
                      <button
                        key={`${button.label}-${i}`}
                        type="button"
                        onClick={() => void send(button.value || button.label)}
                        className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900"
                      >
                        {button.label}
                      </button>
                    ),
                  )}
                </div>
              ) : null}
            </div>
          </div>
        ))}

        {status ? (
          <p role="status" aria-live="polite" className="text-xs text-slate-500">
            {status}
          </p>
        ) : null}
      </div>

      <form
        className="border-t border-slate-200 px-3 pt-3"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}
        onSubmit={(event) => {
          event.preventDefault();
          const text = input;
          setInput('');
          void send(text);
        }}
      >
        <div className="flex items-end gap-2">
          <label htmlFor="embed-input" className="sr-only">
            Type your message
          </label>
          <input
            id="embed-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Type your message…"
            // 16px minimum stops iOS zooming the whole WebView on focus.
            className="min-h-11 flex-1 rounded-full border border-slate-300 px-4 py-2.5 text-base outline-none focus:border-slate-400"
            enterKeyHint="send"
            autoComplete="off"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="min-h-11 rounded-full px-5 py-2.5 text-base font-medium text-white disabled:opacity-50"
            style={{ background: accent }}
          >
            Send
          </button>
        </div>
        <p className="mt-2 text-center text-[11px] leading-snug text-slate-500">{props.footerNote}</p>
      </form>
    </div>
  );
}
