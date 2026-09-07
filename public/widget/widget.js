/*!
 * Embeddable Website Chat Widget (Module 8)
 * Vanilla JS, no build step, no dependencies. Served as a static asset.
 *
 * This widget contains NO business logic. It only sends/receives messages
 * via the backend API (POST /api/chat SSE stream + GET /api/chat/realtime
 * realtime stream). All AI logic lives server-side.
 *
 * The embed tag is `async`, so nothing here may assume it ran before the page
 * finished parsing. Three things follow from that and must stay true:
 *   - the script tag is found by `document.currentScript` (still set during a
 *     classic async script) with a `[data-bot-id]` lookup as the fallback;
 *   - `init()` handles both "still loading" and "already loaded", because an
 *     async script can execute either side of DOMContentLoaded;
 *   - nothing on the host page can call into the widget synchronously, since
 *     there is no global API and no guaranteed execution order.
 *
 * Configure via data-* attributes on the <script> tag:
 *   data-bot-id   (REQUIRED) public bot id
 *   data-api      API base URL (default: origin of this script's src)
 *   data-color    primary color (default #045fff)
 *   data-position right | left (default right)
 *   data-title    header title (default "Website Assistant")
 *   data-welcome  welcome message (default customer support/sales greeting)
 *   data-lang     en | ar | auto (default auto)
 */
(function () {
  'use strict';

  // ---- Resolve the script tag & config --------------------------------------
  var script = document.currentScript;
  if (!script) {
    var candidates = document.querySelectorAll('script[data-bot-id]');
    script = candidates[candidates.length - 1];
  }
  if (!script) {
    console.error('[chat-widget] could not locate widget script tag');
    return;
  }

  var botId = script.getAttribute('data-bot-id');
  if (!botId) {
    console.error('[chat-widget] missing required data-bot-id attribute');
    return;
  }

  // An async tag makes double-embedding much easier to do by accident: a tag
  // in the theme footer and another in a page builder block no longer race in a
  // predictable order, and two copies would fight over the same localStorage
  // conversation. First one mounted wins.
  var alreadyMounted = false;
  try {
    // Attribute value comes from the host page's markup, so a stray quote would
    // throw a selector SyntaxError rather than simply not matching.
    alreadyMounted = !!document.querySelector('[data-aiba-host="' + String(botId).replace(/["\\]/g, '\\$&') + '"]');
  } catch (e) {}
  if (alreadyMounted) return;

  function deriveApiOrigin() {
    try {
      return new URL(script.src).origin;
    } catch (e) {
      return window.location.origin;
    }
  }

  var cfg = {
    botId: botId,
    api: (script.getAttribute('data-api') || deriveApiOrigin()).replace(/\/+$/, ''),
    color: script.getAttribute('data-color') || '#045fff',
    position: script.getAttribute('data-position') === 'left' ? 'left' : 'right',
    title: script.getAttribute('data-title') || 'Website Assistant',
    welcome:
      script.getAttribute('data-welcome') ||
      'Hi, I can help with services, pricing, appointments, orders, and support. What would you like to sort out today?',
    lang: script.getAttribute('data-lang') || 'auto',
    autoOpen: script.getAttribute('data-auto-open') === 'true',
    autoOpenDelaySeconds: Number(script.getAttribute('data-auto-open-delay') || 3)
  };

  // ---- Attachments ----------------------------------------------------------
  // These mirror src/lib/attachments/policy.ts. The server is what enforces
  // them — it re-reads the size and sniffs the real bytes — but the visitor is
  // told the rule here, before they spend two minutes uploading a video over a
  // phone connection only to be refused at the end of it.
  //
  // There is no build step and no shared module to import from, so if the
  // policy file changes these two lines change with it.
  var ATTACH_MAX_BYTES = 10 * 1024 * 1024;
  var ATTACH_ACCEPT =
    '.png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.csv,image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/csv';

  // ---- Storage helpers ------------------------------------------------------
  // Every access is wrapped: Safari private mode throws on setItem once the
  // quota is zero, and a browser set to block site data throws on the property
  // lookup itself, before any method is called. A widget that cannot remember a
  // visitor still has to talk to them.
  var NS = 'aiba:' + cfg.botId + ':';
  function lsGet(key) {
    try { return window.localStorage.getItem(NS + key); } catch (e) { return null; }
  }
  function lsSet(key, val) {
    try { window.localStorage.setItem(NS + key, val); } catch (e) {}
  }
  function lsDel(key) {
    try { window.localStorage.removeItem(NS + key); } catch (e) {}
  }

  // Session-scoped twins. Anything that should reset when the visitor comes back
  // tomorrow belongs here rather than in localStorage — a chat invite is the
  // example that made the difference obvious.
  function ssGet(key) {
    try { return window.sessionStorage.getItem(NS + key); } catch (e) { return null; }
  }
  function ssSet(key, val) {
    try { window.sessionStorage.setItem(NS + key, val); } catch (e) {}
  }

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) {
      try { return window.crypto.randomUUID(); } catch (e) {}
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  var visitorId = lsGet('visitorId');
  if (!visitorId) {
    visitorId = uuid();
    lsSet('visitorId', visitorId);
  }
  var conversationId = lsGet('conversationId') || null;

  // ---- State ----------------------------------------------------------------
  var state = {
    open: false,
    sending: false,
    rtl: cfg.lang === 'ar',
    welcomed: false,
    lastTimestamp: lsGet('after') || null,
    seenIds: {},
    realtimeSource: null,
    reconnectTimer: null,
    currentBotBubble: null
    ,quickActions: [],
    configLoaded: false,
    activeForm: null,
    agentLabel: 'Team',
    agentAvatarUrl: null,
    avatarMode: 'initials',
    launcherIcon: 'chat',
    launcherImageUrl: null,
    launcherLabel: null,
    launcherDotMode: 'unread',
    launcherDotColor: '#ef4444',
    headerTextColor: '#ffffff',
    headerStyle: 'solid',
    onlineLabel: 'Team is replying - live',
    offlineLabel: 'Replying soon',
    typingLabel: 'Team is typing',
    footerBranding: null,
    proactiveMessage: null,
    autoOpen: cfg.autoOpen,
    autoOpenOnce: true,
    autoOpenDelaySeconds: cfg.autoOpenDelaySeconds,
    // Per-device auto-open: desktop and mobile each get their own on/off + delay
    // so you can (e.g.) nudge laptops at 2s but wait 60s on phones where the
    // chat takes over the whole screen. Fall back to the legacy single setting.
    autoOpenDesktop: cfg.autoOpen,
    autoOpenMobile: cfg.autoOpen,
    autoOpenDelayDesktopSeconds: cfg.autoOpenDelaySeconds,
    autoOpenDelayMobileSeconds: 60,
    // Attention "glow" on the launcher (pulsing halo + expanding ring). Stops
    // for good once the visitor opens the chat. Mobile-only by default.
    launcherGlow: false,
    launcherGlowMobileOnly: true,
    hasOpened: false,
    launcherStyle: 'circle',
    launcherSize: 'default',
    windowSize: 'default',
    mobileMode: 'fullscreen',
    showOnMobile: true,
    showOnDesktop: true,
    bottomOffset: 20,
    sideOffset: 20,
    position: cfg.position,
    zIndex: 2147483000,
    autoOpenTimer: null,
    // CSAT (post-conversation rating). Off unless the company enables it.
    csatEnabled: false,
    csatPrompt: 'How would you rate this conversation?',
    csatThanks: 'Thanks for your feedback!',
    csatCommentEnabled: true,
    botAnswered: false, // at least one assistant/agent reply this session
    csatPrompted: false, // rating UI currently shown (defer close)
    csatDone: false, // rated or skipped this conversation
    csatRating: 0,
    // Proactive campaigns: behaviour-triggered nudges from the dashboard.
    proactiveRules: [],
    proactiveTimer: null,
    // Pre-chat form: ask for contact details before the first message. Off
    // until the company turns it on, so nothing changes for existing sites.
    prechat: {
      enabled: false,
      askName: true,
      askEmail: true,
      askPhone: false,
      required: true,
      allowSkip: true,
      title: 'Before we start',
      intro: 'Leave your details and we can pick this up again if we get cut off.',
      buttonLabel: 'Start chat'
    },
    prechatDone: false,
    // Opening hours. `isOpenNow === null` means the company never filled its
    // hours in; that is "unknown", and unknown shows the ordinary chat.
    hours: {
      isOpenNow: null,
      offlineEnabled: true,
      offlineMessage: 'We are closed at the moment. Leave your details and we will reply as soon as we are back.',
      offlineFormEnabled: true,
      offlineButtonLabel: 'Leave a message'
    },
    offlineShown: false,
    gateRow: null, // the pre-chat / leave-a-message card currently in the flow
    composerLocked: false,
    restored: false, // transcript already fetched for this conversation
    // Attachments. `bubbleByMessageId` is what lets a bubble that is already on
    // screen be upgraded in place once its file's signed URL arrives: the
    // realtime stream carries a message's text but not what it is attached to,
    // and a signed URL expires, so neither can be baked into the first render.
    uploading: false,
    bubbleByMessageId: {},
    attachmentsShown: {},
    attachSyncTimer: null
  };

  // ---- Styles ---------------------------------------------------------------
  var P = 'aiba-';
  function buildStyleEl() {
    var css = [
      // Belt-and-braces: even though the widget lives inside a Shadow DOM (host
      // page CSS can't reach in), pin the launcher/window to the viewport with
      // !important so nothing - not even a stray inherited rule - can drop them
      // into page flow (the classic "button shows up in the footer" bug).
      ':host{all:initial}',
      // Single source of truth for the brand color. Every accent below reads
      // var(--aiba-color); applyWidgetAppearance() updates this one property on the
      // root so a config-loaded color repaints the whole widget (not just header).
      '.' + P + 'root{--aiba-color:' + cfg.color + '}',
      '.' + P + 'root,.' + P + 'root *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}',
      '.' + P + 'launcher{position:fixed!important;bottom:20px;z-index:2147483000;width:60px;height:60px;border-radius:50%;border:none;cursor:pointer;box-shadow:0 12px 34px rgba(17,24,39,.22);background:var(--aiba-color);color:#fff;display:flex;align-items:center;justify-content:center;transition:transform .15s ease,box-shadow .15s ease;margin:0}',
      '.' + P + 'root.' + P + 'open .' + P + 'launcher{display:none!important}',
      '.' + P + 'launcher{overflow:visible}',
      '.' + P + 'launcher.' + P + 'pill{width:auto;min-width:64px;padding:0 16px;border-radius:999px;gap:8px;font-size:14px;font-weight:600}',
      '.' + P + 'launcher-label{display:none}',
      '.' + P + 'pill .' + P + 'launcher-label{display:inline}',
      '.' + P + 'launcher-dot{position:absolute;right:2px;top:2px;width:16px;height:16px;border-radius:50%;background:#ef4444;border:3px solid #fff;box-shadow:0 5px 12px rgba(15,23,42,.24)}',
      '.' + P + 'pill .' + P + 'launcher-dot{right:-2px;top:-2px}',
      // Attention glow: a breathing halo on the launcher plus an expanding ring
      // drawn by ::after (outset box-shadow, so it never covers the icon). The
      // color comes from --aiba-glow, set from the brand color in JS.
      '.' + P + 'launcher.' + P + 'glow{animation:' + P + 'glowpulse 1.8s ease-in-out infinite}',
      '.' + P + 'launcher.' + P + 'glow::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;animation:' + P + 'glowring 1.8s ease-out infinite}',
      '@keyframes ' + P + 'glowpulse{0%,100%{box-shadow:0 12px 34px rgba(17,24,39,.22),0 0 0 0 var(--aiba-glow)}50%{box-shadow:0 12px 34px rgba(17,24,39,.22),0 0 22px 6px var(--aiba-glow)}}',
      '@keyframes ' + P + 'glowring{0%{box-shadow:0 0 0 0 var(--aiba-glow)}70%{box-shadow:0 0 0 16px rgba(0,0,0,0)}100%{box-shadow:0 0 0 0 rgba(0,0,0,0)}}',
      '@media (prefers-reduced-motion:reduce){.' + P + 'launcher.' + P + 'glow,.' + P + 'launcher.' + P + 'glow::after{animation:none}}',
      '.' + P + 'launcher-img{width:28px;height:28px;border-radius:50%;object-fit:cover}',
      '.' + P + 'launcher-initials{font-size:13px;font-weight:900;letter-spacing:0}',
      '.' + P + 'launcher:hover{transform:translateY(-1px) scale(1.04);box-shadow:0 16px 42px rgba(17,24,39,.28)}',
      '.' + P + 'launcher svg{width:28px;height:28px;fill:#fff}',
      '.' + P + 'pos-right{right:20px}',
      '.' + P + 'pos-left{left:20px}',
      '.' + P + 'window{position:fixed!important;bottom:90px;z-index:2147483000;width:396px;height:auto;max-height:calc(100vh - 110px);background:#fff;border-radius:22px;box-shadow:0 22px 70px rgba(15,23,42,.28);display:none;flex-direction:column;overflow:hidden;border:1px solid rgba(15,23,42,.08)}',
      '.' + P + 'window.' + P + 'show{display:flex}',
      '.' + P + 'header{background:var(--aiba-color);color:#fff;padding:16px 18px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex:0 0 auto;min-height:76px}',
      '.' + P + 'head-left{display:flex;align-items:center;gap:12px;min-width:0}',
      '.' + P + 'head-avatar{width:42px;height:42px;border-radius:50%;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.28);color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;letter-spacing:.2px;overflow:hidden;flex:0 0 auto;box-shadow:inset 0 1px 0 rgba(255,255,255,.2)}',
      '.' + P + 'head-avatar img{width:100%;height:100%;object-fit:cover}',
      '.' + P + 'head-avatar svg{width:24px;height:24px;fill:currentColor}',
      '.' + P + 'header h3{margin:0;font-size:16px;font-weight:800;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:245px}',
      '.' + P + 'status{font-size:12px;font-weight:700;opacity:.95;margin-top:4px;display:flex;align-items:center;gap:6px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.' + P + 'status:before{content:"";width:9px;height:9px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.18);flex:0 0 auto}',
      '.' + P + 'close{background:rgba(255,255,255,.13);border:none;color:#fff;font-size:25px;line-height:1;cursor:pointer;padding:0;width:44px;height:44px;border-radius:50%;opacity:.96;display:flex;align-items:center;justify-content:center;flex:0 0 auto}',
      '.' + P + 'close:hover{opacity:1;background:rgba(255,255,255,.22)}',
      '.' + P + 'msgs{flex:0 1 auto;min-height:0;max-height:min(var(--aiba-msgs-max,360px),calc(100vh - 310px));overflow-y:auto;padding:20px 16px 14px;background:#f3f6fb;display:flex;flex-direction:column;gap:12px;scrollbar-width:thin;scrollbar-color:#cbd5e1 transparent}',
      '.' + P + 'msgs::-webkit-scrollbar{width:6px}',
      '.' + P + 'msgs::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:999px}',
      '.' + P + 'row{display:flex;width:100%}',
      '.' + P + 'row.' + P + 'me{justify-content:flex-end}',
      '.' + P + 'row.' + P + 'them{justify-content:flex-start}',
      '.' + P + 'row.' + P + 'sys{justify-content:center}',
      '.' + P + 'avatar{width:28px;height:28px;border-radius:50%;background:var(--aiba-color);color:#fff;display:none;align-items:center;justify-content:center;font-size:10px;font-weight:800;margin-right:8px;align-self:flex-start;overflow:hidden;flex:0 0 auto;box-shadow:0 3px 10px rgba(15,23,42,.12);letter-spacing:.1px}',
      '.' + P + 'avatar img{width:100%;height:100%;object-fit:cover}',
      '.' + P + 'avatar svg{width:18px;height:18px;fill:currentColor}',
      '.' + P + 'them .' + P + 'avatar{display:flex}',
      '.' + P + 'bubble{max-width:86%;padding:14px 15px;border-radius:14px;font-size:15px;line-height:1.48;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:anywhere;box-shadow:0 1px 2px rgba(15,23,42,.08)}',
      '.' + P + 'me .' + P + 'bubble{background:var(--aiba-color);color:#fff;border-bottom-right-radius:5px}',
      '.' + P + 'them .' + P + 'bubble{background:#fff;color:#172033;border:1px solid #e6edf5;border-bottom-left-radius:5px;white-space:normal}',
      '.' + P + 'sys .' + P + 'bubble{background:transparent;color:#888;font-size:12px;text-align:center;max-width:100%}',
      '.' + P + 'bubble p{margin:0 0 10px}',
      '.' + P + 'bubble p:last-child{margin-bottom:0}',
      '.' + P + 'bubble ul{margin:0 0 12px 0;padding-left:0;list-style:none;display:flex;flex-direction:column;gap:7px}',
      '.' + P + 'bubble li{position:relative;padding-left:16px}',
      '.' + P + 'bubble li:before{content:"";position:absolute;left:0;top:.68em;width:5px;height:5px;border-radius:50%;background:#334155}',
      '.' + P + 'bubble li strong{font-weight:800}',
      '.' + P + 'bubble strong{font-weight:600}',
      '.' + P + 'bubble a{color:inherit;text-decoration:underline}',
      '.' + P + 'bubble code{background:rgba(0,0,0,.06);border-radius:4px;padding:1px 4px;font-size:90%;font-family:ui-monospace,Menlo,Consolas,monospace}',
      '.' + P + 'hr{display:block;border-top:1px solid rgba(0,0,0,.15);margin:6px 0}',
      '.' + P + 'tablewrap{overflow-x:auto;margin:6px 0;-webkit-overflow-scrolling:touch}',
      '.' + P + 'table{border-collapse:collapse;font-size:13px;width:100%}',
      '.' + P + 'table th,.' + P + 'table td{border:1px solid rgba(0,0,0,.12);padding:4px 8px;text-align:left;white-space:nowrap}',
      '.' + P + 'table th{background:rgba(0,0,0,.04);font-weight:600}',
      '.' + P + 'actions{flex:0 0 auto;display:flex;gap:8px;flex-wrap:wrap;padding:14px 16px 12px;border-top:1px solid #e9eef6;background:#f3f6fb;max-height:128px;overflow-y:auto}',
      '.' + P + 'action{border:1px solid #cfe0f5;background:#fff;color:var(--aiba-color);border-radius:999px;padding:9px 13px;font-size:14px;font-weight:700;line-height:1.2;cursor:pointer;max-width:100%;white-space:nowrap;text-align:center;transition:border-color .15s,color .15s,background .15s,box-shadow .15s}',
      '.' + P + 'action:hover{border-color:var(--aiba-color);color:var(--aiba-color);background:#f8fbff;box-shadow:0 3px 10px rgba(37,99,235,.12)}',
      '.' + P + 'form{flex:0 0 auto;border-top:1px solid #eee;background:#fff;padding:16px;display:none;gap:12px;flex-direction:column;max-height:78%;overflow-y:auto}',
      '.' + P + 'form.' + P + 'show{display:flex}',
      '.' + P + 'window.' + P + 'form-open .' + P + 'msgs,.' + P + 'window.' + P + 'form-open .' + P + 'actions,.' + P + 'window.' + P + 'form-open .' + P + 'footer,.' + P + 'window.' + P + 'form-open .' + P + 'brand{display:none}',
      '.' + P + 'window.' + P + 'form-open .' + P + 'form{flex:1 1 auto;max-height:none}',
      '.' + P + 'form-title{font-size:15px;font-weight:600;color:#111827}',
      '.' + P + 'form-desc{font-size:12px;color:#6b7280;margin-top:-6px}',
      '.' + P + 'field{display:flex;flex-direction:column;gap:5px}',
      '.' + P + 'field label{font-size:12px;font-weight:500;color:#374151}',
      '.' + P + 'field input,.' + P + 'field textarea,.' + P + 'field select{width:100%;border:1px solid #d6d9de;border-radius:8px;padding:10px 12px;font-size:14px;outline:none}',
      '.' + P + 'field input:focus,.' + P + 'field textarea:focus,.' + P + 'field select:focus{border-color:var(--aiba-color)}',
      '.' + P + 'field textarea{min-height:64px;resize:vertical}',
      '.' + P + 'form-row{display:flex;gap:8px;margin-top:2px}',
      '.' + P + 'form-submit{flex:1;border:none;background:var(--aiba-color);color:#fff;border-radius:8px;padding:11px 14px;font-size:14px;font-weight:600;cursor:pointer}',
      '.' + P + 'form-submit:disabled{opacity:.6;cursor:not-allowed}',
      '.' + P + 'form-cancel{border:1px solid #d6d9de;background:#fff;color:#4b5563;border-radius:8px;padding:11px 16px;font-size:14px;cursor:pointer}',
      '.' + P + 'footer{flex:0 0 auto;display:flex;gap:10px;padding:12px 12px 8px;border-top:1px solid #e9eef6;background:#fff;align-items:center}',
      '.' + P + 'input{flex:1 1 auto;border:1px solid #d7e2ef;border-radius:14px;padding:13px 14px;font-size:15px;outline:none;resize:none;min-width:0;color:#172033}',
      '.' + P + 'input::placeholder{color:#9aa8bb}',
      '.' + P + 'input:focus{border-color:var(--aiba-color);box-shadow:0 0 0 2px rgba(37,99,235,.12)}',
      '.' + P + 'send{flex:0 0 auto;border:none;background:var(--aiba-color);color:#fff;width:48px;height:48px;border-radius:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 18px rgba(37,99,235,.24)}',
      '.' + P + 'send:disabled{opacity:.5;cursor:not-allowed}',
      '.' + P + 'send svg{width:22px;height:22px;fill:#fff}',
      '.' + P + 'send svg path{fill:#fff}',
      '.' + P + 'typing{display:flex;gap:4px;padding:11px 14px;background:#e9ebef;border-radius:14px;border-bottom-left-radius:4px;width:auto}',
      '.' + P + 'typing-label{font-size:12px;color:#6b7280;padding:0 4px 4px}',
      '.' + P + 'typing span{width:7px;height:7px;border-radius:50%;background:#9aa0a6;animation:' + P + 'blink 1.2s infinite both}',
      '.' + P + 'typing span:nth-child(2){animation-delay:.2s}',
      '.' + P + 'typing span:nth-child(3){animation-delay:.4s}',
      '.' + P + 'brand{flex:0 0 auto;padding:8px 18px 13px;text-align:center;font-size:11px;line-height:1.25;color:#8491a6;background:#fff}',
      // Inline AI-driven actions rendered in the message flow (forms, chips, cards, CTA).
      '.' + P + 'inline-form{max-width:92%;width:100%;background:#fff;border:1px solid #e3e6ea;border-radius:14px;border-bottom-left-radius:4px;padding:12px;display:flex;flex-direction:column;gap:10px}',
      '.' + P + 'inline-form .' + P + 'form-title{font-size:14px}',
      '.' + P + 'chips{display:flex;flex-wrap:wrap;gap:6px;width:100%;max-width:92%}',
      // Citations sit under an answer and must not compete with it: smaller
      // than body text, muted, and wrapping rather than scrolling.
      '.' + P + 'sources{display:flex;flex-direction:column;gap:4px;width:100%;max-width:92%;margin-top:-2px}',
      '.' + P + 'sources-label{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;opacity:.55}',
      '.' + P + 'sources-list{display:flex;flex-wrap:wrap;gap:6px}',
      '.' + P + 'source{font-size:12px;line-height:1.3;padding:3px 8px;border-radius:6px;background:rgba(0,0,0,.05);color:inherit;text-decoration:none;opacity:.8;max-width:100%;overflow-wrap:anywhere}',
      'a.' + P + 'source:hover{opacity:1;text-decoration:underline}',
      '.' + P + 'chip{border:1px solid var(--aiba-color);color:var(--aiba-color);background:#fff;border-radius:999px;padding:7px 12px;font-size:13px;font-weight:500;cursor:pointer;line-height:1.25;max-width:100%;white-space:normal;text-align:left}',
      '.' + P + 'chip:hover{background:#f4f7ff}',
      '.' + P + 'cards{display:flex;flex-direction:column;gap:8px;width:100%;max-width:92%}',
      '.' + P + 'card{border:1px solid #e3e6ea;border-radius:12px;background:#fff;padding:10px 12px;display:flex;flex-direction:column;gap:4px}',
      '.' + P + 'card-title{font-size:14px;font-weight:600;color:#111827}',
      '.' + P + 'card-desc{font-size:12px;color:#6b7280;word-wrap:break-word;overflow-wrap:anywhere}',
      '.' + P + 'card-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;margin-top:2px}',
      '.' + P + 'card-price{font-weight:700;color:#111827}',
      '.' + P + 'card-stock{font-size:11px;padding:2px 8px;border-radius:999px;font-weight:600}',
      '.' + P + 'stk-in{background:#e7f6ec;color:#1a7f3c}',
      '.' + P + 'stk-out{background:#fdeaea;color:#c0392b}',
      '.' + P + 'stk-unk{background:#eef0f3;color:#6b7280}',
      '.' + P + 'card-actions{display:flex;gap:6px;margin-top:6px;flex-wrap:wrap}',
      '.' + P + 'card-btn{border:1px solid #d9dce1;background:#fff;color:#374151;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:500;cursor:pointer}',
      '.' + P + 'card-btn:hover{border-color:var(--aiba-color);color:var(--aiba-color)}',
      '.' + P + 'cta{max-width:92%;width:100%;background:#fff;border:1px solid #e3e6ea;border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:8px}',
      '.' + P + 'cta-msg{font-size:13px;color:#374151;line-height:1.4}',
      '.' + P + 'cta-row{display:flex;gap:6px;flex-wrap:wrap}',
      '.' + P + 'cta-btn{border:none;background:var(--aiba-color);color:#fff;border-radius:8px;padding:7px 12px;font-size:13px;font-weight:600;cursor:pointer}',
      '.' + P + 'cta-btn.' + P + 'ghost{background:#fff;color:var(--aiba-color);border:1px solid var(--aiba-color)}',
      // CSAT rating card (post-conversation): star row + optional comment.
      '.' + P + 'csat{max-width:92%;width:100%;background:#fff;border:1px solid #e3e6ea;border-radius:14px;border-bottom-left-radius:4px;padding:12px;display:flex;flex-direction:column;gap:10px}',
      '.' + P + 'csat-title{font-size:14px;font-weight:700;color:#172033}',
      '.' + P + 'stars{display:flex;gap:6px}',
      '.' + P + 'star{font-size:26px;line-height:1;cursor:pointer;color:#cbd5e1;background:none;border:none;padding:0;transition:color .12s,transform .12s}',
      '.' + P + 'star:hover{transform:scale(1.12)}',
      '.' + P + 'star.' + P + 'on{color:#f5b301}',
      '.' + P + 'csat textarea{width:100%;border:1px solid #d6d9de;border-radius:8px;padding:9px 11px;font-size:13px;outline:none;min-height:54px;resize:vertical}',
      '.' + P + 'csat textarea:focus{border-color:var(--aiba-color)}',
      '.' + P + 'csat-row{display:flex;gap:8px}',
      '.' + P + 'csat-submit{flex:1;border:none;background:var(--aiba-color);color:#fff;border-radius:8px;padding:10px 14px;font-size:14px;font-weight:700;cursor:pointer}',
      '.' + P + 'csat-submit:disabled{opacity:.5;cursor:not-allowed}',
      '.' + P + 'csat-skip{border:1px solid #d6d9de;background:#fff;color:#6b7280;border-radius:8px;padding:10px 14px;font-size:13px;cursor:pointer}',
      // Pre-chat / out-of-hours card. Same shape as the CSAT card so the two
      // moments the widget interrupts the conversation look like one thing.
      '.' + P + 'gate{max-width:92%;width:100%;background:#fff;border:1px solid #e3e6ea;border-radius:14px;border-bottom-left-radius:4px;padding:13px;display:flex;flex-direction:column;gap:10px}',
      '.' + P + 'gate-title{font-size:14px;font-weight:700;color:#172033}',
      '.' + P + 'gate-intro{font-size:13px;line-height:1.45;color:#4b5563}',
      '.' + P + 'gate-row{display:flex;gap:8px;flex-wrap:wrap}',
      '.' + P + 'gate-submit{flex:1 1 auto;border:none;background:var(--aiba-color);color:#fff;border-radius:8px;padding:10px 14px;font-size:14px;font-weight:700;cursor:pointer}',
      '.' + P + 'gate-submit:disabled{opacity:.5;cursor:not-allowed}',
      '.' + P + 'gate-skip{border:1px solid #d6d9de;background:#fff;color:#6b7280;border-radius:8px;padding:10px 14px;font-size:13px;cursor:pointer}',
      '.' + P + 'gate-error{font-size:12px;font-weight:600;color:#b42318}',
      '.' + P + 'closed{max-width:92%;width:100%;background:#fff7ed;border:1px solid #fed7aa;border-radius:14px;border-bottom-left-radius:4px;padding:12px 13px;font-size:13px;line-height:1.45;color:#7c2d12}',
      // Focus states. There were none: a keyboard visitor could tab through the
      // whole chat with nothing on screen telling them where they were. Three
      // rules because the three surfaces have different backgrounds — the white
      // window, the brand-coloured header, and whatever the host page painted
      // behind the launcher (hence the two-tone ring, visible on light or dark).
      '.' + P + 'root :focus-visible{outline:3px solid var(--aiba-color);outline-offset:2px}',
      '.' + P + 'header :focus-visible{outline:3px solid #fff;outline-offset:2px}',
      '.' + P + 'launcher:focus-visible{outline:none;box-shadow:0 0 0 3px #fff,0 0 0 6px #0f172a,0 12px 34px rgba(17,24,39,.22)}',
      // Attachments. The paperclip sits inside the composer next to the send
      // button; the file input beside it is display:none, which also keeps it
      // out of focusables() and therefore out of the tab trap.
      '.' + P + 'attach{flex:0 0 auto;border:1px solid #d7e2ef;background:#fff;color:#5b6b82;width:44px;height:44px;border-radius:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}',
      '.' + P + 'attach:hover{border-color:var(--aiba-color);color:var(--aiba-color)}',
      '.' + P + 'attach:disabled{opacity:.45;cursor:not-allowed}',
      '.' + P + 'attach svg{width:20px;height:20px;fill:currentColor}',
      '.' + P + 'file{display:none}',
      // An attachment bubble drops the sender's colour on BOTH sides: a photo
      // inside a solid brand-blue block reads as a rendering fault, and a file
      // link needs a background it can actually be legible on. Written as
      // `.bubble.att-bubble` and placed after the me/them rules so it outranks
      // them without !important.
      '.' + P + 'bubble.' + P + 'att-bubble{background:#fff;color:#172033;border:1px solid #e6edf5;padding:6px;max-width:86%}',
      '.' + P + 'att-img{display:block;line-height:0;border-radius:9px;overflow:hidden}',
      '.' + P + 'att-img img{display:block;max-width:100%;max-height:260px;object-fit:contain;border-radius:9px}',
      '.' + P + 'att-file{display:flex;align-items:center;gap:9px;padding:8px 10px;text-decoration:none;color:#172033;border-radius:9px;min-width:0}',
      '.' + P + 'att-file:hover{background:#f3f6fb}',
      '.' + P + 'att-icon{flex:0 0 auto;font-size:16px;line-height:1}',
      '.' + P + 'att-name{font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
      '.' + P + 'att-size{flex:0 0 auto;font-size:12px;color:#6b7280}',
      '@keyframes ' + P + 'blink{0%,80%,100%{opacity:.3}40%{opacity:1}}',
      '.' + P + 'window[dir="rtl"] .' + P + 'me .' + P + 'bubble{border-bottom-right-radius:14px;border-bottom-left-radius:4px}',
      '.' + P + 'window[dir="rtl"] .' + P + 'them .' + P + 'bubble{border-bottom-left-radius:14px;border-bottom-right-radius:4px}',
      '@media (max-width:480px){.' + P + 'window{width:100%;height:100%;max-height:100%;bottom:0;left:0;right:0;border-radius:0;border:none}.' + P + 'header{padding:calc(14px + env(safe-area-inset-top)) 16px 14px;min-height:calc(74px + env(safe-area-inset-top))}.' + P + 'header h3{max-width:calc(100vw - 132px)}.' + P + 'msgs{flex:1 1 auto;min-height:0;max-height:none;padding:18px 16px 12px}.' + P + 'window.' + P + 'mobile-sheet{height:82vh;max-height:82vh;bottom:0;top:auto;border-radius:22px 22px 0 0}.' + P + 'footer{padding:12px 12px 8px}.' + P + 'brand{padding:7px 18px calc(12px + env(safe-area-inset-bottom));font-size:10.5px}.' + P + 'launcher{bottom:calc(16px + env(safe-area-inset-bottom))}}'
    ].join('');
    var style = document.createElement('style');
    style.setAttribute('data-aiba-widget', cfg.botId);
    style.textContent = css;
    return style;
  }

  // ---- DOM build ------------------------------------------------------------
  var els = {};
  var host = null; // the Shadow DOM host element mounted on <html>
  var shadow = null;
  function buildDom() {
    var root = document.createElement('div');
    root.className = P + 'root';

    var winId = P + 'win-' + Math.random().toString(36).slice(2, 9);
    var titleId = winId + '-title';

    var launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.className = P + 'launcher ' + P + 'pos-' + cfg.position;
    launcher.setAttribute('aria-label', cfg.title);
    // The launcher is the button that opens a dialog, and it is the only thing
    // announcing whether that dialog is currently open.
    launcher.setAttribute('aria-haspopup', 'dialog');
    launcher.setAttribute('aria-expanded', 'false');
    launcher.setAttribute('aria-controls', winId);
    launcher.innerHTML = launcherMarkup();

    var win = document.createElement('div');
    win.className = P + 'window ' + P + 'pos-' + cfg.position;
    win.id = winId;
    win.setAttribute('role', 'dialog');
    // Focus is trapped while the window is open (Escape is the way out), so the
    // dialog has to be declared modal or a screen reader would keep offering
    // page content the visitor can no longer reach.
    win.setAttribute('aria-modal', 'true');
    win.setAttribute('aria-labelledby', titleId);
    if (state.rtl) win.setAttribute('dir', 'rtl');

    var header = document.createElement('div');
    header.className = P + 'header';
    var headLeft = document.createElement('div');
    headLeft.className = P + 'head-left';
    var headAvatar = document.createElement('div');
    headAvatar.className = P + 'head-avatar';
    headAvatar.setAttribute('aria-hidden', 'true');
    headAvatar.textContent = initials(cfg.title || state.agentLabel || 'AI');
    var h3 = document.createElement('h3');
    h3.id = titleId;
    h3.textContent = cfg.title;
    var titleWrap = document.createElement('div');
    var status = document.createElement('div');
    status.className = P + 'status';
    // The header line flips between "Team is replying" and "Replying soon" as
    // the config loads and as opening hours change, so it has to announce.
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = state.onlineLabel;
    var close = document.createElement('button');
    close.type = 'button';
    close.className = P + 'close';
    close.setAttribute('aria-label', 'Close chat');
    close.innerHTML = '<span aria-hidden="true">&times;</span>';
    titleWrap.appendChild(h3);
    titleWrap.appendChild(status);
    headLeft.appendChild(headAvatar);
    headLeft.appendChild(titleWrap);
    header.appendChild(headLeft);
    header.appendChild(close);

    var msgs = document.createElement('div');
    msgs.className = P + 'msgs';
    // `log` is the role for a running transcript: additions are announced, and
    // the reader is not dragged back to the top on every new message.
    msgs.setAttribute('role', 'log');
    msgs.setAttribute('aria-live', 'polite');
    msgs.setAttribute('aria-relevant', 'additions');
    msgs.setAttribute('aria-label', 'Conversation');

    var actions = document.createElement('div');
    actions.className = P + 'actions';
    actions.setAttribute('role', 'group');
    actions.setAttribute('aria-label', 'Suggested actions');

    var form = document.createElement('form');
    form.className = P + 'form';
    form.setAttribute('aria-label', 'Enquiry form');
    var brand = document.createElement('div');
    brand.className = P + 'brand';
    brand.textContent = footerText();
    brand.style.display = 'block';

    var footer = document.createElement('div');
    footer.className = P + 'footer';
    footer.setAttribute('role', 'group');
    footer.setAttribute('aria-label', 'Write a message');
    var input = document.createElement('input');
    input.className = P + 'input';
    input.type = 'text';
    input.setAttribute('placeholder', state.rtl ? '...' : 'Type your message...');
    input.setAttribute('aria-label', 'Message');
    input.setAttribute('autocomplete', 'off');
    var send = document.createElement('button');
    send.type = 'button';
    send.className = P + 'send';
    send.setAttribute('aria-label', 'Send message');
    send.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>';

    // The paperclip and the input it drives. The label says what may be sent
    // and how big, because a refusal after the upload is a bad way to find out.
    var attach = document.createElement('button');
    attach.type = 'button';
    attach.className = P + 'attach';
    attach.setAttribute('aria-label', 'Attach a photo or file. Images, PDF or plain text, up to 10 MB.');
    attach.title = 'Attach a photo or file (images, PDF or plain text, up to 10 MB)';
    attach.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5S13.5 3.62 13.5 5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/></svg>';

    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.className = P + 'file';
    fileInput.setAttribute('accept', ATTACH_ACCEPT);
    // Driven entirely by the button above, so it is hidden from both the
    // pointer and the tab order rather than being a second visible control.
    fileInput.setAttribute('aria-hidden', 'true');
    fileInput.tabIndex = -1;

    footer.appendChild(attach);
    footer.appendChild(fileInput);
    footer.appendChild(input);
    footer.appendChild(send);

    win.appendChild(header);
    win.appendChild(msgs);
    win.appendChild(form);
    win.appendChild(actions);
    win.appendChild(footer);
    win.appendChild(brand);

    root.appendChild(launcher);
    root.appendChild(win);

    // ---- Shadow DOM isolation -----------------------------------------------
    // Everything lives inside a closed-off Shadow DOM so the host website's CSS
    // (e.g. `button{position:static!important}`, theme `button{background:…}`,
    // `display:none` resets) physically cannot reach the launcher/window. This
    // is what fixes: launcher landing in the footer, launcher staying visible
    // while the chat is open, and the brand color being overridden by the site.
    host = document.createElement('div');
    host.setAttribute('data-aiba-host', cfg.botId);
    // Reset the host element itself and keep it out of page flow; the fixed
    // children inside the shadow root escape to the viewport regardless.
    host.style.cssText = 'all:initial';
    shadow = host.attachShadow({ mode: 'open' });
    shadow.appendChild(buildStyleEl());
    shadow.appendChild(root);
    // Mount on <html>, not <body>. A `transform`/`filter`/`perspective` on the
    // host page's <body> (common with page builders, animation libs, RTL themes)
    // turns `position:fixed` into `position:absolute` relative to that ancestor -
    // which drops the launcher into the page flow near the footer instead of
    // pinning it to the viewport. <html> is almost never transformed.
    (document.documentElement || document.body).appendChild(host);

    els = { root: root, launcher: launcher, win: win, header: header, msgs: msgs, actions: actions, form: form, brand: brand, input: input, send: send, attach: attach, file: fileInput, title: h3, status: status, headAvatar: headAvatar };
    applyWidgetAppearance();

    launcher.addEventListener('click', toggle);
    close.addEventListener('click', toggle);
    send.addEventListener('click', onSend);
    attach.addEventListener('click', function () {
      if (state.uploading || state.sending || state.composerLocked) return;
      fileInput.click();
    });
    fileInput.addEventListener('change', function () {
      var picked = fileInput.files && fileInput.files[0];
      // Cleared straight away so picking the SAME file twice still fires a
      // change event — otherwise a failed upload cannot be retried as-is.
      fileInput.value = '';
      if (picked) uploadAttachment(picked);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        onSend();
      }
    });

    // Escape closes, and Tab is kept inside the open window. Both listeners sit
    // on the window rather than on the document so a page that stops keyboard
    // events at its own root cannot swallow them, and so nothing is intercepted
    // while the chat is shut.
    win.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') {
        e.preventDefault();
        e.stopPropagation();
        toggle();
        return;
      }
      if (e.key === 'Tab') trapTab(e);
    });
  }

  // Everything inside the window that a keyboard can land on, in DOM order and
  // minus anything currently hidden (the takeover form hides the composer, the
  // composer is disabled while a pre-chat form is up).
  var FOCUSABLE =
    'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  function focusables() {
    if (!els.win) return [];
    var all = els.win.querySelectorAll(FOCUSABLE);
    var out = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].getClientRects().length) out.push(all[i]);
    }
    return out;
  }

  function trapTab(e) {
    var list = focusables();
    if (!list.length) return;
    var first = list[0];
    var last = list[list.length - 1];
    // shadowRoot.activeElement, not document.activeElement: from the document's
    // point of view focus is on the host element the whole time.
    var current = shadow && shadow.activeElement;
    if (e.shiftKey && (current === first || !current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && current === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // Put the caret where the visitor is meant to type. That is the pre-chat
  // form's first field while the gate is up, and the message box otherwise.
  function focusFirst() {
    var target = null;
    if (state.gateRow) target = state.gateRow.querySelector('input,textarea,select,button');
    if (!target && els.input && !els.input.disabled) target = els.input;
    if (!target) target = focusables()[0];
    if (target) {
      try { target.focus(); } catch (e) {}
    }
  }

  // ---- Rendering ------------------------------------------------------------
  // `messageId` is optional and only supplied for bubbles that came from a
  // stored message. Keeping the element against its id is what lets an
  // attachment be dropped into a bubble that is already on screen — see
  // syncAttachments().
  function addBubble(kind, text, messageId) {
    var row = document.createElement('div');
    row.className = P + 'row ' + P + kind; // me | them | sys
    var bubble = document.createElement('div');
    bubble.className = P + 'bubble';
    if (kind === 'them') bubble.innerHTML = renderRichMarkdown(text);
    else bubble.textContent = text;
    if (kind === 'them') {
      var avatar = document.createElement('div');
      avatar.className = P + 'avatar';
      // Repeated on every reply, and says nothing the bubble does not.
      avatar.setAttribute('aria-hidden', 'true');
      avatar.title = state.agentLabel || 'Assistant';
      if (state.avatarMode === 'image' && state.agentAvatarUrl) {
        var img = document.createElement('img');
        img.src = state.agentAvatarUrl;
        img.alt = '';
        avatar.appendChild(img);
      } else if (state.avatarMode === 'headset' || state.avatarMode === 'chat' || state.avatarMode === 'spark') {
        avatar.innerHTML = launcherSvg(state.avatarMode);
      } else {
        avatar.textContent = initials(cfg.title || state.agentLabel || 'AI');
      }
      row.appendChild(avatar);
    }
    row.appendChild(bubble);
    els.msgs.appendChild(row);
    if (messageId) state.bubbleByMessageId[messageId] = bubble;
    scrollDown(kind === 'me'); // always follow the user's own message
    return bubble;
  }

  // ---- Attachments ----------------------------------------------------------
  function formatBytes(bytes) {
    if (!bytes || bytes < 0) return '0 KB';
    if (bytes < 1024) return bytes + ' B';
    var kb = bytes / 1024;
    if (kb < 1024) return Math.round(kb) + ' KB';
    var mb = kb / 1024;
    return (mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10) + ' MB';
  }

  // The one element that represents a stored file: an image shown inline, or a
  // labelled link for everything else. Both open in a new tab, and both are
  // built with createElement rather than innerHTML — the URL is ours, but the
  // FILE NAME came off a stranger's machine and is never parsed as markup.
  function buildAttachmentEl(att) {
    var link = document.createElement('a');
    // The signed URL is minted by our own API, but check it anyway: a
    // `javascript:` href would be the whole attack, and this is one comparison.
    var href = String(att && att.url ? att.url : '');
    link.href = /^https?:\/\//i.test(href) ? href : '#';
    link.target = '_blank';
    link.rel = 'noreferrer noopener';

    if (att.kind === 'image') {
      link.className = P + 'att-img';
      link.title = att.name + ' - ' + formatBytes(att.size);
      var img = document.createElement('img');
      img.src = link.href;
      img.alt = att.name;
      img.loading = 'lazy';
      link.appendChild(img);
      return link;
    }

    link.className = P + 'att-file';
    var icon = document.createElement('span');
    icon.className = P + 'att-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '📎';
    var name = document.createElement('span');
    name.className = P + 'att-name';
    name.textContent = att.name;
    var size = document.createElement('span');
    size.className = P + 'att-size';
    size.textContent = formatBytes(att.size);
    link.appendChild(icon);
    link.appendChild(name);
    link.appendChild(size);
    return link;
  }

  // Replace a bubble's text with its attachment. The text it had was the
  // fallback line the server stores in content_text ("Sent a photo: cat.png"),
  // which exists so the message is never blank in the inbox or in search —
  // once the file itself is on screen, repeating the name above it is noise.
  function fillBubbleWithAttachment(bubble, att) {
    bubble.textContent = '';
    bubble.className = P + 'bubble ' + P + 'att-bubble';
    bubble.appendChild(buildAttachmentEl(att));
  }

  function setUploading(on) {
    state.uploading = on;
    if (els.attach) els.attach.disabled = on || state.sending || state.composerLocked;
  }

  function uploadAttachment(file) {
    if (state.uploading || state.sending || state.composerLocked) return;
    if (file.size > ATTACH_MAX_BYTES) {
      addBubble('sys', file.name + ' is ' + formatBytes(file.size) + '. The limit is ' + formatBytes(ATTACH_MAX_BYTES) + '.');
      return;
    }

    setUploading(true);
    // A placeholder in the visitor's own column, so the chat reacts the instant
    // they pick something rather than sitting still for the whole upload. It
    // becomes the attachment on success and the reason on failure.
    var placeholder = addBubble('me', 'Sending ' + file.name + '...');

    var body = new FormData();
    body.append('publicBotId', cfg.botId);
    body.append('visitorId', visitorId);
    if (conversationId) body.append('conversationId', conversationId);
    body.append('file', file);

    fetch(cfg.api + '/api/widget/upload', { method: 'POST', body: body })
      .then(function (res) {
        return res
          .json()
          .catch(function () { return {}; })
          .then(function (data) {
            if (!res.ok) {
              var err = new Error((data && data.code) || 'upload_' + res.status);
              err.friendly = data && data.error ? String(data.error) : '';
              err.statusCode = res.status;
              throw err;
            }
            return data;
          });
      })
      .then(function (data) {
        // A visitor may lead with a photo before typing anything, in which case
        // the server created the conversation. Adopt it so the next typed
        // message continues this chat instead of starting a second one.
        if (data.conversationId && data.conversationId !== conversationId) {
          conversationId = data.conversationId;
          lsSet('conversationId', conversationId);
          connectRealtime();
        }
        if (data.messageId) {
          state.seenIds[data.messageId] = true;
          state.bubbleByMessageId[data.messageId] = placeholder;
        }
        if (data.attachment) {
          state.attachmentsShown[data.attachment.id] = true;
          fillBubbleWithAttachment(placeholder, data.attachment);
        }
        scrollDown(true);
      })
      .catch(function (err) {
        placeholder.textContent = attachmentErrorMessage(err, file);
        reportClientError('Widget attachment upload failed', {
          error: err && err.message ? err.message : String(err),
          statusCode: err && err.statusCode ? err.statusCode : undefined
        });
      })
      .then(function () {
        setUploading(false);
      });
  }

  function attachmentErrorMessage(err, file) {
    // The API already writes these for a person to read, so prefer its wording
    // and only fall back when the request never got far enough to produce one.
    if (err && err.friendly) return err.friendly;
    return 'Could not send ' + file.name + '. Check your connection and try again.';
  }

  // Fetch this conversation's attachments and drop each one into the bubble it
  // belongs to.
  //
  // This exists because neither of the two ways a message reaches the widget
  // carries its file: the realtime stream sends the message row's text and
  // nothing else, and the restored transcript is the same. A signed URL could
  // not be delivered that way in any case — it expires — so the URL is always
  // minted now, and the bubble is upgraded in place afterwards.
  function syncAttachments() {
    if (!conversationId) return;
    var url =
      cfg.api +
      '/api/widget/upload?publicBotId=' +
      encodeURIComponent(cfg.botId) +
      '&conversationId=' +
      encodeURIComponent(conversationId) +
      '&visitorId=' +
      encodeURIComponent(visitorId);
    fetch(url)
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (!data || !data.attachments || !data.attachments.length) return;
        var painted = false;
        for (var i = 0; i < data.attachments.length; i++) {
          var att = data.attachments[i];
          if (!att || !att.id || state.attachmentsShown[att.id]) continue;
          var bubble = state.bubbleByMessageId[att.messageId];
          if (!bubble) continue;
          state.attachmentsShown[att.id] = true;
          fillBubbleWithAttachment(bubble, att);
          painted = true;
        }
        if (painted) scrollDown(false);
      })
      .catch(function () {});
  }

  // Coalesced: an agent sending three files in a row must not become three
  // list fetches, and the row has to be on screen before it can be decorated.
  function scheduleAttachmentSync() {
    if (!conversationId || state.attachSyncTimer) return;
    state.attachSyncTimer = setTimeout(function () {
      state.attachSyncTimer = null;
      syncAttachments();
    }, 600);
  }

  function renderQuickActions() {
    if (!els.actions) return;
    els.actions.innerHTML = '';
    if (!state.quickActions || !state.quickActions.length) {
      els.actions.style.display = 'none';
      return;
    }
    els.actions.style.display = 'flex';
    state.quickActions.forEach(function (action) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = P + 'action';
      btn.textContent = action.label;
      if (action.description) btn.title = action.description;
      btn.addEventListener('click', function () { handleQuickAction(action); });
      els.actions.appendChild(btn);
    });
  }

  function reportClientError(message, metadata) {
    try {
      fetch(cfg.api + '/api/client-errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publicBotId: cfg.botId,
          visitorId: visitorId,
          conversationId: conversationId || undefined,
          source: 'widget',
          severity: 'error',
          message: String(message || 'Widget error'),
          route: window.location.href,
          statusCode: metadata && metadata.statusCode ? metadata.statusCode : undefined,
          metadata: metadata || {}
        })
      }).catch(function () {});
    } catch (e) {}
  }

  function loadWidgetConfig(context) {
    var url =
      cfg.api +
      '/api/widget/config?publicBotId=' +
      encodeURIComponent(cfg.botId) +
      '&context=' +
      encodeURIComponent(context || 'initial') +
      '&pageUrl=' +
      encodeURIComponent(window.location.href);
    return fetch(url)
      .then(function (res) {
        if (!res.ok) {
          return res.text().then(function (body) {
            var code = 'config_' + res.status;
            try {
              var parsed = JSON.parse(body || '{}');
              if (parsed && parsed.error) code = parsed.error;
            } catch (e) {}
            var err = new Error(code);
            err.statusCode = res.status;
            err.responseBody = body ? String(body).slice(0, 500) : '';
            throw err;
          });
        }
        return res.json();
      })
      .then(function (data) {
        state.configLoaded = true;
        if (data.bot) {
          if (data.bot.title) {
            cfg.title = data.bot.title;
            if (els.title) els.title.textContent = cfg.title;
            if (els.launcher) els.launcher.setAttribute('aria-label', cfg.title);
          }
          if (data.bot.welcomeMessage) cfg.welcome = data.bot.welcomeMessage;
          if (data.bot.primaryColor && !script.getAttribute('data-color')) cfg.color = data.bot.primaryColor;
          state.agentLabel = data.bot.agentLabel || state.agentLabel;
          state.agentAvatarUrl = data.bot.agentAvatarUrl || null;
          state.avatarMode = data.bot.avatarMode || state.avatarMode;
          state.launcherIcon = data.bot.launcherIcon || state.launcherIcon;
          state.launcherImageUrl = data.bot.launcherImageUrl || null;
          state.launcherLabel = data.bot.launcherLabel || null;
          state.launcherDotMode = data.bot.launcherDotMode || state.launcherDotMode;
          state.launcherDotColor = data.bot.launcherDotColor || state.launcherDotColor;
          state.headerTextColor = data.bot.headerTextColor || state.headerTextColor;
          state.headerStyle = data.bot.headerStyle || state.headerStyle;
          state.onlineLabel = data.bot.onlineLabel || state.onlineLabel;
          state.offlineLabel = data.bot.offlineLabel || state.offlineLabel;
          state.typingLabel = data.bot.typingLabel || state.typingLabel;
          state.footerBranding = data.bot.footerBranding || null;
          state.proactiveMessage = data.bot.proactiveMessage || null;
          state.autoOpen = Boolean(data.bot.autoOpen);
          state.autoOpenOnce = data.bot.autoOpenOnce !== false;
          state.autoOpenDelaySeconds = Number(data.bot.autoOpenDelaySeconds || 3);
          // Per-device auto-open (fall back to the legacy single fields).
          state.autoOpenDesktop = data.bot.autoOpenDesktop != null ? Boolean(data.bot.autoOpenDesktop) : state.autoOpen;
          state.autoOpenMobile = data.bot.autoOpenMobile != null ? Boolean(data.bot.autoOpenMobile) : state.autoOpen;
          state.autoOpenDelayDesktopSeconds = Number(data.bot.autoOpenDelayDesktopSeconds != null ? data.bot.autoOpenDelayDesktopSeconds : state.autoOpenDelaySeconds);
          state.autoOpenDelayMobileSeconds = Number(data.bot.autoOpenDelayMobileSeconds != null ? data.bot.autoOpenDelayMobileSeconds : 60);
          state.launcherGlow = Boolean(data.bot.launcherGlow);
          state.launcherGlowMobileOnly = data.bot.launcherGlowMobileOnly !== false;
          state.launcherStyle = data.bot.launcherStyle || state.launcherStyle;
          state.launcherSize = data.bot.launcherSize || state.launcherSize;
          state.windowSize = data.bot.windowSize || state.windowSize;
          state.mobileMode = data.bot.mobileMode || state.mobileMode;
          state.position = data.bot.position || state.position;
          state.showOnMobile = data.bot.showOnMobile !== false;
          state.showOnDesktop = data.bot.showOnDesktop !== false;
          state.bottomOffset = Number(data.bot.bottomOffset || 20);
          state.sideOffset = Number(data.bot.sideOffset || 20);
          state.zIndex = Number(data.bot.zIndex || 2147483000);
          state.csatEnabled = Boolean(data.bot.csatEnabled);
          if (data.bot.csatPrompt) state.csatPrompt = data.bot.csatPrompt;
          if (data.bot.csatThanks) state.csatThanks = data.bot.csatThanks;
          state.csatCommentEnabled = data.bot.csatCommentEnabled !== false;
          if (state.csatEnabled && conversationId && lsGet('csat:' + conversationId) === '1') {
            state.csatDone = true;
          }
        }
        if (data.prechat) {
          state.prechat = {
            enabled: Boolean(data.prechat.enabled),
            askName: data.prechat.askName !== false,
            askEmail: data.prechat.askEmail !== false,
            askPhone: Boolean(data.prechat.askPhone),
            required: data.prechat.required !== false,
            allowSkip: data.prechat.allowSkip !== false,
            title: data.prechat.title || state.prechat.title,
            intro: data.prechat.intro || state.prechat.intro,
            buttonLabel: data.prechat.buttonLabel || state.prechat.buttonLabel
          };
          if (conversationId && lsGet('prechat:' + conversationId) === '1') state.prechatDone = true;
        }
        if (data.hours) {
          state.hours = {
            // Left as null when the company has no opening hours on file. Only
            // an explicit `false` is treated as closed anywhere below.
            isOpenNow: data.hours.isOpenNow === true ? true : data.hours.isOpenNow === false ? false : null,
            offlineEnabled: data.hours.offlineEnabled !== false,
            offlineMessage: data.hours.offlineMessage || state.hours.offlineMessage,
            offlineFormEnabled: data.hours.offlineFormEnabled !== false,
            offlineButtonLabel: data.hours.offlineButtonLabel || state.hours.offlineButtonLabel
          };
        }
        if (data.bot) {
          if (els.launcher) {
            // loadWidgetConfig runs after every answer; only touch the DOM when
            // the launcher actually changed so it never visibly flickers.
            var markup = launcherMarkup();
            if (markup !== state._launcherMarkup) {
              els.launcher.innerHTML = markup;
              state._launcherMarkup = markup;
            }
          }
          if (els.status) els.status.textContent = statusText();
          if (els.headAvatar) renderHeaderAvatar();
          if (els.brand) {
            els.brand.textContent = footerText();
            els.brand.style.display = 'block';
          }
          applyWidgetAppearance();
          scheduleAutoOpen();
        }
        state.proactiveRules = Array.isArray(data.proactiveRules) ? data.proactiveRules : [];
        scheduleProactiveCampaign();
        state.quickActions = data.quickActions || [];
        renderQuickActions();
        // The window can be open before this response lands (auto-open, or a
        // fast click), so the gate has to be checked again once the settings
        // that decide whether there is one are finally known.
        if (state.open) maybeRenderGate();
      })
      .catch(function (err) {
        state.configLoaded = true;
        reportClientError('Widget config failed', {
          error: err && err.message ? err.message : String(err),
          statusCode: err && err.statusCode ? err.statusCode : undefined,
          responseBody: err && err.responseBody ? err.responseBody : undefined
        });
      });
  }

  function actionUrl(action) {
    var c = action.config || {};
    if (action.actionType === 'phone_call') return c.phone ? 'tel:' + c.phone : '';
    if (action.actionType === 'whatsapp') {
      var phone = String(c.phone || '').replace(/[^0-9]/g, '');
      return phone ? 'https://wa.me/' + phone : String(c.url || '');
    }
    return String(c.url || '');
  }

  function handleQuickAction(action) {
    closeActionForm();
    if (action.actionType === 'direct_answer') {
      addBubble('them', String((action.config || {}).direct_answer || action.description || ''));
      loadWidgetConfig('after_answer');
      return;
    }
    if (action.actionType === 'external_link' || action.actionType === 'product_link' || action.actionType === 'whatsapp' || action.actionType === 'phone_call') {
      var url = actionUrl(action);
      logQuickAction(action, {});
      if (url) window.open(url, action.actionType === 'phone_call' ? '_self' : '_blank', 'noopener');
      return;
    }
    if (
      action.actionType === 'lead_form' ||
      action.actionType === 'appointment_form' ||
      (action.actionType === 'request_human' && action.formSchema && action.formSchema.length)
    ) {
      renderActionForm(action);
      return;
    }
    var text = String((action.config || {}).message_text || action.label || '').trim();
    if (text) {
      addBubble('me', text);
      sendMessage(text);
    }
  }

  function closeActionForm() {
    state.activeForm = null;
    if (!els.form) return;
    els.form.classList.remove(P + 'show');
    els.win.classList.remove(P + 'form-open');
    els.form.innerHTML = '';
  }

  // Build one labelled field row (input/textarea/select). Shared by the
  // takeover quick-action form and the inline AI-driven forms.
  function createFieldRow(field) {
    var wrap = document.createElement('div');
    wrap.className = P + 'field';
    var fieldId = P + 'f-' + Math.random().toString(36).slice(2, 9);
    var label = document.createElement('label');
    label.textContent = field.label || field.name;
    label.setAttribute('for', fieldId);
    wrap.appendChild(label);
    var input;
    if (field.type === 'textarea') {
      input = document.createElement('textarea');
    } else if (field.type === 'select') {
      input = document.createElement('select');
      (field.options || []).forEach(function (opt) {
        var option = document.createElement('option');
        option.value = opt;
        option.textContent = opt;
        input.appendChild(option);
      });
    } else {
      input = document.createElement('input');
      input.type = field.type || 'text';
    }
    input.id = fieldId;
    input.name = field.name;
    if (field.required) input.required = true;
    if (field.placeholder) input.placeholder = field.placeholder;
    wrap.appendChild(input);
    return wrap;
  }

  // Append an arbitrary element as a chat row (used by inline action UIs).
  function appendRow(kind, el) {
    var row = document.createElement('div');
    row.className = P + 'row ' + P + kind;
    row.appendChild(el);
    els.msgs.appendChild(row);
    scrollDown();
    return row;
  }

  function renderActionForm(action) {
    state.activeForm = action;
    els.form.innerHTML = '';
    els.form.classList.add(P + 'show');
    // Form takes over the window so all fields + buttons are visible and scroll.
    els.win.classList.add(P + 'form-open');
    var title = document.createElement('div');
    title.className = P + 'form-title';
    title.textContent = action.label;
    els.form.appendChild(title);
    if (action.description) {
      var desc = document.createElement('div');
      desc.className = P + 'form-desc';
      desc.textContent = action.description;
      els.form.appendChild(desc);
    }

    (action.formSchema || []).forEach(function (field) {
      els.form.appendChild(createFieldRow(field));
    });

    if (!action.formSchema || !action.formSchema.length) {
      var fallback = document.createElement('div');
      fallback.className = P + 'field';
      fallback.innerHTML = '<label>Name</label><input name="name" required><label>Email</label><input name="email" type="email">';
      els.form.appendChild(fallback);
    }

    var row = document.createElement('div');
    row.className = P + 'form-row';
    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = P + 'form-cancel';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', closeActionForm);
    var submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = P + 'form-submit';
    submit.textContent = action.label || 'Submit';
    row.appendChild(cancel);
    row.appendChild(submit);
    els.form.appendChild(row);
  }

  function collectFormValues(form) {
    var values = {};
    var data = new FormData(form);
    data.forEach(function (value, key) {
      values[key] = String(value);
    });
    return values;
  }

  function logQuickAction(action, values) {
    return fetch(cfg.api + '/api/widget/actions/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicBotId: cfg.botId,
        visitorId: visitorId,
        conversationId: conversationId || undefined,
        actionId: action.id,
        pageUrl: window.location.href,
        formValues: values || {}
      })
    })
      .then(function (res) { return res.ok ? res.json() : Promise.reject(new Error('action_' + res.status)); })
      .then(function (data) {
        if (data.conversationId) {
          conversationId = data.conversationId;
          lsSet('conversationId', conversationId);
          connectRealtime();
        }
        return data;
      });
  }

  // Only auto-scroll when the user is already near the bottom, so streaming
  // tokens / new cards never yank them away while they're reading history.
  // `force` overrides this (used for the user's own outgoing message).
  function isNearBottom() {
    var el = els.msgs;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }
  function scrollDown(force) {
    if (!els.msgs) return;
    if (force || isNearBottom()) els.msgs.scrollTop = els.msgs.scrollHeight;
  }

  // ---- Typewriter reveal ----------------------------------------------------
  // The server can stream the answer in big chunks (a whole sentence at once),
  // which made replies "dump" in and snap to the bottom. Instead of rendering
  // each chunk immediately, we buffer the full text and reveal it word-by-word
  // at a smooth, self-pacing rate. Because the revealed text grows a little per
  // animation frame, scrollDown() follows it as a gentle glide, not a jump.
  var raf = window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : function (cb) { return setTimeout(cb, 16); };
  var caf = window.cancelAnimationFrame ? window.cancelAnimationFrame.bind(window) : clearTimeout;
  var tw = { bubble: null, full: '', shown: 0, frame: 0 };

  function twRender() {
    if (tw.bubble) tw.bubble.innerHTML = renderRichMarkdown(tw.full.slice(0, tw.shown));
  }

  // The transcript is a live region, and a reply that rewrites itself twenty
  // times a second would be read out twenty times. Marking the log busy while
  // the typewriter runs holds the announcement back until the answer is whole.
  function setLogBusy(on) {
    if (!els.msgs) return;
    if (on) els.msgs.setAttribute('aria-busy', 'true');
    else els.msgs.removeAttribute('aria-busy');
  }

  // Begin a fresh reveal for a new bot bubble. Finishes any previous one first
  // so nothing is ever left half-typed if a new answer starts.
  function twReset(bubble) {
    twFlush();
    tw.bubble = bubble;
    tw.full = '';
    tw.shown = 0;
    setLogBusy(true);
  }

  // Feed newly-streamed text into the buffer and make sure the loop is running.
  function twPush(text) {
    if (text == null || text === '') return;
    tw.full += text;
    if (!tw.frame && tw.bubble) tw.frame = raf(twTick);
  }

  function twTick() {
    tw.frame = 0;
    if (!tw.bubble) return;
    var remaining = tw.full.length - tw.shown;
    if (remaining > 0) {
      // Ease-out pace: reveal ~1/16 of the backlog each frame (min 2 chars), so
      // it catches up quickly when far behind but eases as it nears the end -
      // reads like steady typing rather than a dump.
      var step = Math.max(2, Math.ceil(remaining / 16));
      var next = tw.shown + step;
      // Snap forward to the next word/line break so words aren't split mid-frame.
      if (next < tw.full.length) {
        var sp = tw.full.indexOf(' ', next);
        var nl = tw.full.indexOf('\n', next);
        var b = sp === -1 ? nl : nl === -1 ? sp : Math.min(sp, nl);
        if (b !== -1 && b - next < 24) next = b + 1;
      }
      tw.shown = Math.min(next, tw.full.length);
      twRender();
      scrollDown();
    }
    // Keep animating only while there is still buffered text to reveal. When it
    // catches up the loop stops; twPush() restarts it when more text arrives.
    if (tw.shown < tw.full.length) tw.frame = raf(twTick);
    else setLogBusy(false);
  }

  // Reveal whatever is buffered immediately and stop animating. Used when the
  // turn ends in a non-streaming way (inline action / handoff / error).
  function twFlush() {
    if (tw.frame) { caf(tw.frame); tw.frame = 0; }
    if (tw.bubble && tw.shown < tw.full.length) {
      tw.shown = tw.full.length;
      twRender();
      scrollDown();
    }
    tw.bubble = null;
    setLogBusy(false);
  }

  var typingRow = null;
  function showTyping() {
    if (typingRow) return;
    typingRow = document.createElement('div');
    typingRow.className = P + 'row ' + P + 'them';
    // The label carries the meaning ("Searching…", "Team is typing"); the three
    // bouncing dots are decoration and would otherwise be read as empty items.
    typingRow.setAttribute('role', 'status');
    typingRow.innerHTML =
      '<div><div class="' + P + 'typing-label">' + escapeHtml(state.typingLabel || 'Team is typing') + '</div><div class="' + P + 'typing" aria-hidden="true"><span></span><span></span><span></span></div></div>';
    els.msgs.appendChild(typingRow);
    scrollDown();
  }
  function hideTyping() {
    if (typingRow && typingRow.parentNode) typingRow.parentNode.removeChild(typingRow);
    typingRow = null;
  }
  function updateTypingLabel(text) {
    if (!text) return;
    if (!typingRow) showTyping();
    var label = typingRow && typingRow.querySelector('.' + P + 'typing-label');
    if (label) label.textContent = text;
  }

  function setRtl(on) {
    if (state.rtl === on) return;
    state.rtl = on;
    if (on) els.win.setAttribute('dir', 'rtl');
    else els.win.removeAttribute('dir');
  }

  function launcherSvg(kind) {
    if (kind === 'headset') return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3C7 3 3 7 3 12v4c0 1.7 1.3 3 3 3h2v-8H5.1C5.6 7.6 8.5 5 12 5s6.4 2.6 6.9 6H16v8h2.2c-.5 1.2-1.7 2-3.2 2h-2v2h2c3.3 0 6-2.7 6-6v-5c0-5-4-9-9-9z"/></svg>';
    if (kind === 'spark') return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2l2.4 6.4L21 11l-6.6 2.6L12 20l-2.4-6.4L3 11l6.6-2.6z"/></svg>';
    if (kind === 'help') return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M11 18h2v-2h-2v2zm1-16C6.5 2 2 6 2 11h2c0-3.9 3.6-7 8-7s8 3.1 8 7-3.6 7-8 7v2c5.5 0 10-4 10-9S17.5 2 12 2zm0 4c-2.2 0-4 1.3-4 3h2c0-.6.9-1 2-1s2 .7 2 1.5c0 1.5-3 1.4-3 4.5h2c0-2 3-2.2 3-4.5C16 7.6 14.2 6 12 6z"/></svg>';
    if (kind === 'question') return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 17a1.25 1.25 0 110-2.5A1.25 1.25 0 0112 19zm1.2-5.1v.6h-2v-.8c0-1.2.7-1.9 1.5-2.5.8-.6 1.4-1.1 1.4-2 0-1-.8-1.7-2-1.7-1.1 0-2 .7-2.4 1.8l-1.8-.8C8.6 6.7 10.1 5.5 12 5.5c2.4 0 4.1 1.5 4.1 3.6 0 1.8-1.1 2.7-2 3.4-.6.5-.9.8-.9 1.4z"/></svg>';
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';
  }

  function launcherMarkup() {
    var label = state.launcherLabel || cfg.title || 'Chat with us';
    var icon = '';
    if (state.launcherIcon === 'custom' && state.launcherImageUrl) {
      icon = '<img class="' + P + 'launcher-img" src="' + escapeHtml(state.launcherImageUrl) + '" alt="">';
    } else if (state.launcherIcon === 'initials') {
      icon = '<span class="' + P + 'launcher-initials">' + escapeHtml(initials(label)) + '</span>';
    } else {
      icon = launcherSvg(state.launcherIcon);
    }
    var dot = state.launcherDotMode === 'hidden'
      ? ''
      : '<span class="' + P + 'launcher-dot" aria-hidden="true" style="background:' + escapeHtml(state.launcherDotColor || '#ef4444') + '"></span>';
    return icon + '<span class="' + P + 'launcher-label">' + escapeHtml(label) + '</span>' + dot;
  }

  function initials(text) {
    var clean = String(text || 'AI').replace(/&/g, ' ').replace(/[^a-z0-9 ]/gi, ' ').trim();
    if (!clean) return 'AI';
    var parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  }

  function renderHeaderAvatar() {
    if (!els.headAvatar) return;
    els.headAvatar.innerHTML = '';
    if (state.avatarMode === 'image' && state.agentAvatarUrl) {
      var img = document.createElement('img');
      img.src = state.agentAvatarUrl;
      img.alt = '';
      els.headAvatar.appendChild(img);
      return;
    }
    if (state.avatarMode === 'headset') {
      els.headAvatar.innerHTML = launcherSvg('headset');
      return;
    }
    if (state.avatarMode === 'chat') {
      els.headAvatar.innerHTML = launcherSvg('chat');
      return;
    }
    if (state.avatarMode === 'spark') {
      els.headAvatar.innerHTML = launcherSvg('spark');
      return;
    }
    els.headAvatar.textContent = initials(cfg.title || state.agentLabel || 'AI');
  }

  function footerText() {
    return (
      state.footerBranding ||
      'AI assistant may be inaccurate. We use messages and contact details to respond to your enquiry and improve support.'
    );
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  // Lightweight, XSS-safe markdown → HTML for chat bubbles. Escapes first, then
  // injects only known tags. Handles bold, inline code, links, headings (shown
  // as bold), bullets, rules and pipe tables — so assistant replies look clean
  // instead of showing raw **, ##, ### or | table | symbols.
  function mdInline(t) {
    return t
      .replace(/\[([^\]]+)\]\((https?:[^\s)]+)\)/g, function (_m, txt, u) {
        return '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + txt + '</a>';
      })
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*\*/g, '');
  }
  function mdRow(line) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); });
  }
  function isTableSep(line) {
    return !!line && line.indexOf('|') !== -1 && /^[\s|:-]+$/.test(line) && line.indexOf('-') !== -1;
  }
  function renderMarkdown(raw) {
    var lines = escapeHtml(raw == null ? '' : String(raw)).split('\n');
    var out = [];
    var i = 0;
    while (i < lines.length) {
      // Pipe table: a row line followed by a |---|---| separator line.
      if (lines[i].indexOf('|') !== -1 && isTableSep(lines[i + 1])) {
        var header = mdRow(lines[i]);
        i += 2;
        var body = [];
        while (i < lines.length && lines[i].indexOf('|') !== -1 && lines[i].trim() !== '') {
          body.push(mdRow(lines[i]));
          i++;
        }
        var html = '<div class="' + P + 'tablewrap"><table class="' + P + 'table"><thead><tr>';
        header.forEach(function (c) { html += '<th>' + mdInline(c) + '</th>'; });
        html += '</tr></thead><tbody>';
        body.forEach(function (r) {
          html += '<tr>';
          for (var k = 0; k < header.length; k++) html += '<td>' + mdInline(r[k] || '') + '</td>';
          html += '</tr>';
        });
        html += '</tbody></table></div>';
        out.push(html);
        continue;
      }
      var line = lines[i];
      if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { out.push('<span class="' + P + 'hr"></span>'); i++; continue; }
      line = line.replace(/^\s{0,3}#{1,6}\s*(.+)$/, '<strong>$1</strong>');
      line = line.replace(/^\s*[-*]\s+/, '• ');
      out.push(mdInline(line));
      i++;
    }
    return out.join('\n');
  }

  function renderRichMarkdown(raw) {
    var lines = escapeHtml(raw == null ? '' : String(raw)).split('\n');
    var out = [];
    var paragraph = [];
    var listItems = [];

    function flushParagraph() {
      if (!paragraph.length) return;
      out.push('<p>' + mdInline(paragraph.join(' ')) + '</p>');
      paragraph = [];
    }

    function flushList() {
      if (!listItems.length) return;
      out.push('<ul>' + listItems.map(function (item) {
        return '<li>' + mdInline(item) + '</li>';
      }).join('') + '</ul>');
      listItems = [];
    }

    for (var i = 0; i < lines.length; i++) {
      if (lines[i].indexOf('|') !== -1 && isTableSep(lines[i + 1])) {
        flushParagraph();
        flushList();
        var header = mdRow(lines[i]);
        i += 2;
        var body = [];
        while (i < lines.length && lines[i].indexOf('|') !== -1 && lines[i].trim() !== '') {
          body.push(mdRow(lines[i]));
          i++;
        }
        i--;
        var html = '<div class="' + P + 'tablewrap"><table class="' + P + 'table"><thead><tr>';
        header.forEach(function (c) { html += '<th>' + mdInline(c) + '</th>'; });
        html += '</tr></thead><tbody>';
        body.forEach(function (r) {
          html += '<tr>';
          for (var k = 0; k < header.length; k++) html += '<td>' + mdInline(r[k] || '') + '</td>';
          html += '</tr>';
        });
        html += '</tbody></table></div>';
        out.push(html);
        continue;
      }

      var line = lines[i];
      if (!line.trim()) {
        flushParagraph();
        flushList();
        continue;
      }
      if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
        flushParagraph();
        flushList();
        out.push('<span class="' + P + 'hr"></span>');
        continue;
      }

      line = line.replace(/^\s{0,3}#{1,6}\s*(.+)$/, '<strong>$1</strong>');
      var bullet = line.match(/^\s*(?:[-*]|&bull;|&#8226;)\s+(.+)$/);
      if (bullet) {
        flushParagraph();
        listItems.push(bullet[1]);
      } else {
        flushList();
        paragraph.push(line.trim());
      }
    }

    flushParagraph();
    flushList();
    return out.join('');
  }

  function isMobileViewport() {
    return window.matchMedia && window.matchMedia('(max-width: 480px)').matches;
  }

  // Convert a #rrggbb (or #rgb) brand color into an rgba() string so the glow
  // halo can be a translucent version of the brand color.
  function hexToRgba(hex, alpha) {
    var h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length !== 6) return 'rgba(37,99,235,' + alpha + ')';
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  function applyWidgetAppearance() {
    if (!els.root || !els.launcher || !els.win) return;
    var isMobile = isMobileViewport();
    var visible = isMobile ? state.showOnMobile : state.showOnDesktop;
    els.root.style.display = visible ? '' : 'none';

    var z = String(state.zIndex || 2147483000);
    els.launcher.style.zIndex = z;
    els.win.style.zIndex = z;

    // Push the (possibly config-loaded) brand color into the single CSS variable
    // so every accent - bubbles, send button, quick actions, chips, CTAs - repaints,
    // not just the launcher/header that get explicit inline colors below.
    els.root.style.setProperty('--aiba-color', cfg.color);
    els.root.style.setProperty('--aiba-glow', hexToRgba(cfg.color, 0.55));

    // Attention glow: on while enabled, applicable to this device, and the
    // visitor hasn't opened the chat yet. Stops permanently after first open.
    var glowOn = state.launcherGlow && !state.hasOpened &&
      (!state.launcherGlowMobileOnly || isMobile);
    els.launcher.classList.toggle(P + 'glow', glowOn);

    var bottom = Number(state.bottomOffset || 20);
    var side = Number(state.sideOffset || 20);
    els.launcher.style.bottom = 'calc(' + bottom + 'px + env(safe-area-inset-bottom))';
    els.launcher.style.right = state.position === 'left' ? 'auto' : 'calc(' + side + 'px + env(safe-area-inset-right))';
    els.launcher.style.left = state.position === 'left' ? 'calc(' + side + 'px + env(safe-area-inset-left))' : 'auto';
    els.launcher.style.background = cfg.color;
    if (els.header) {
      els.header.style.background =
        state.headerStyle === 'gradient'
          ? 'linear-gradient(135deg,' + cfg.color + ',#1d4ed8)'
          : cfg.color;
      els.header.style.color = state.headerTextColor || '#ffffff';
    }
    // NB: the window box (size + position) is applied below, gated by viewport —
    // inline px must NOT be set on mobile or it overrides the full-screen media query.

    els.launcher.classList.toggle(P + 'pill', state.launcherStyle === 'pill');
    var launcherSizes = {
      compact: { w: 52, h: 52, icon: 23 },
      default: { w: 60, h: 60, icon: 28 },
      large: { w: 68, h: 68, icon: 32 }
    };
    var ls = launcherSizes[state.launcherSize] || launcherSizes.default;
    if (state.launcherStyle === 'pill') {
      els.launcher.style.height = ls.h + 'px';
      els.launcher.style.minWidth = Math.max(96, ls.w + 40) + 'px';
      els.launcher.style.width = 'auto';
    } else {
      els.launcher.style.width = ls.w + 'px';
      els.launcher.style.height = ls.h + 'px';
      els.launcher.style.minWidth = '';
    }

    var windowSizes = {
      compact: { w: 360, h: 560 },
      default: { w: 396, h: 640 },
      large: { w: 430, h: 700 }
    };
    var ws = windowSizes[state.windowSize] || windowSizes.default;
    els.root.style.setProperty('--aiba-msgs-max', Math.max(260, ws.h - 280) + 'px');
    if (isMobile) {
      // Phones: hand the window box to the responsive CSS. Clear any desktop
      // inline px (they'd beat the media query); applyMobileViewport handles the
      // visual-viewport pinning so the input stays above the keyboard.
      els.win.classList.toggle(P + 'mobile-sheet', state.mobileMode === 'bottom_sheet');
      els.win.style.width = '';
      els.win.style.height = '';
      els.win.style.maxHeight = '';
      els.win.style.top = '';
      els.win.style.bottom = '';
      els.win.style.left = '';
      els.win.style.right = '';
      applyMobileViewport();
    } else {
      els.win.classList.remove(P + 'mobile-sheet');
      els.win.style.top = '';
      // Never let the box exceed the viewport on small laptops / narrow tablets
      // (between the phone breakpoint and full desktop). Falls back to the
      // configured size when there is room.
      els.win.style.width = 'min(' + ws.w + 'px, calc(100vw - ' + (side * 2) + 'px))';
      els.win.style.height = '';
      els.win.style.maxHeight = 'min(' + ws.h + 'px, calc(100vh - ' + (bottom + 90) + 'px))';
      els.win.style.bottom = 'calc(' + (bottom + 70) + 'px + env(safe-area-inset-bottom))';
      els.win.style.right = state.position === 'left' ? 'auto' : 'calc(' + side + 'px + env(safe-area-inset-right))';
      els.win.style.left = state.position === 'left' ? 'calc(' + side + 'px + env(safe-area-inset-left))' : 'auto';
    }
  }

  // Pin the open window to the *visual* viewport on phones so the on-screen
  // keyboard doesn't push the input field off-screen (a common mobile chat bug).
  function applyMobileViewport() {
    if (!els.win || !isMobileViewport()) return;
    if (state.mobileMode === 'bottom_sheet') {
      // CSS (.mobile-sheet) owns the 74vh bottom sheet.
      els.win.style.height = '';
      els.win.style.top = '';
      els.win.style.bottom = '';
      return;
    }
    var vv = window.visualViewport;
    // Some mobile browsers report visualViewport.height as 0 mid-rotation /
    // before first paint. Falling back to innerHeight here keeps the opened
    // chat from collapsing to a 0px (invisible) box on phones.
    var h = (vv && vv.height) ? vv.height : (window.innerHeight || document.documentElement.clientHeight || 0);
    if (!h) h = 640; // last-ditch: never render a zero-height window
    var top = vv ? vv.offsetTop : 0;
    els.win.style.height = Math.round(h) + 'px';
    els.win.style.top = Math.round(top) + 'px';
    els.win.style.bottom = 'auto';
    els.win.style.left = '0px';
    els.win.style.right = '0px';
    els.win.style.width = '100%';
  }

  function openWidget(auto) {
    if (state.open) return;
    state.open = true;
    state.hasOpened = true; // glow never returns once the chat has been opened
    els.root.classList.add(P + 'open');
    els.launcher.classList.remove(P + 'glow');
    els.launcher.setAttribute('aria-expanded', 'true');
    els.win.classList.add(P + 'show');
    if (!state.configLoaded) loadWidgetConfig('initial');
    // The greeting waits for the restore: a returning visitor's window has to
    // fill with the conversation they were having, not with "Hi, how can I
    // help?" printed over the top of it. With no stored conversation this calls
    // back immediately and nothing is delayed.
    restoreTranscript(function () {
      if (!state.open) return;
      if (!state.welcomed) {
        addBubble('them', auto && state.proactiveMessage ? state.proactiveMessage : cfg.welcome);
        state.welcomed = true;
      }
      maybeRenderGate();
      connectRealtime();
      // Only grab focus on a deliberate open — auto-open shouldn't pop the
      // mobile keyboard or steal focus from the page.
      if (!auto) focusFirst();
    });
  }

  function closeWidget() {
    if (!state.open) return;
    // Whether the keyboard is inside the window decides who gets focus back.
    // An auto-open that never took focus must not snatch it away on close.
    var hadFocus = !!(shadow && shadow.activeElement);
    state.open = false;
    els.root.classList.remove(P + 'open');
    els.launcher.setAttribute('aria-expanded', 'false');
    els.win.classList.remove(P + 'show');
    disconnectRealtime();
    // Focus was trapped inside a window that is now hidden, so hand it back to
    // the control that opened it — the standard way out of a dialog.
    if (hadFocus) {
      try { els.launcher.focus(); } catch (e) {}
    }
  }

  function scheduleAutoOpen() {
    if (state.autoOpenTimer || state.open) return;
    // Pick this device's auto-open on/off and delay (desktop vs mobile).
    var isMobile = isMobileViewport();
    var enabled = isMobile ? state.autoOpenMobile : state.autoOpenDesktop;
    var delay = isMobile ? state.autoOpenDelayMobileSeconds : state.autoOpenDelayDesktopSeconds;
    if (!enabled) return;
    if (state.autoOpenOnce && lsGet('autoOpened') === '1') return;
    state.autoOpenTimer = setTimeout(function () {
      state.autoOpenTimer = null;
      if (state.autoOpenOnce) lsSet('autoOpened', '1');
      if (!state.open) openWidget(true);
    }, Math.max(0, Number(delay || 0)) * 1000);
  }

  // Behaviour-triggered proactive nudge: pick the first active rule whose URL
  // pattern matches this page and, after its delay, open the chat with that
  // message. Shown at most once per session so visitors aren't nagged.
  /**
   * One flag per invite, held for the session.
   *
   * This used to be a single `proactiveShown` in localStorage, which meant two
   * things nobody intended. localStorage never expires, so a visitor saw one
   * invite in their life and never another; and the flag was shared by every
   * invite on the bot, so whichever fired first permanently silenced the rest —
   * a pricing nudge would switch off the checkout nudge for that person for
   * good. Keyed by invite id and kept in sessionStorage, each invite gets one
   * showing per visit, which is what the original comment said it did.
   */
  function proactiveKey(rule) {
    // Fall back to the message when an older cached config has no id, so a
    // widget that has not reloaded still tracks invites separately.
    return 'proactiveShown:' + (rule.id || rule.message);
  }

  function scheduleProactiveCampaign() {
    if (state.proactiveTimer || state.open) return;
    if (!state.proactiveRules || !state.proactiveRules.length) return;
    var href = window.location.href;
    var rule = null;
    for (var i = 0; i < state.proactiveRules.length; i++) {
      var r = state.proactiveRules[i];
      if (!r || !r.message) continue;
      if (r.matchUrl && href.indexOf(r.matchUrl) === -1) continue;
      // Already shown this visit — try the next match rather than giving up,
      // so a second invite on the same page still gets its turn.
      if (ssGet(proactiveKey(r)) === '1') continue;
      rule = r;
      break;
    }
    if (!rule) return;
    var delay = Math.max(0, Number(rule.delaySeconds || 0)) * 1000;
    state.proactiveTimer = setTimeout(function () {
      state.proactiveTimer = null;
      if (state.open) return;
      ssSet(proactiveKey(rule), '1');
      state.proactiveMessage = rule.message;
      openWidget(true); // welcome bubble uses proactiveMessage on auto-open
    }, delay);
  }

  // ---- Open/close & realtime ------------------------------------------------
  function toggle() {
    if (state.open) {
      // First close after a real exchange → ask for a rating instead of closing.
      // The CSAT card's Skip/Submit then performs the actual close.
      if (shouldPromptCsat()) { renderCsat(); return; }
      closeWidget();
    } else {
      openWidget(false);
    }
  }

  function realtimeUrl() {
    return (
      cfg.api +
      '/api/chat/realtime?publicBotId=' +
      encodeURIComponent(cfg.botId) +
      '&conversationId=' +
      encodeURIComponent(conversationId) +
      '&visitorId=' +
      encodeURIComponent(visitorId)
    );
  }

  function connectRealtime() {
    if (!state.open || !conversationId || state.realtimeSource) return;
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }

    var es = new EventSource(realtimeUrl());
    state.realtimeSource = es;
    es.onmessage = function (event) {
      var evt;
      try {
        evt = JSON.parse(event.data);
      } catch (e) {
        return;
      }
      handleRealtimeEvent(evt);
    };
    es.onerror = function () {
      disconnectRealtime();
      if (state.open && conversationId) {
        state.reconnectTimer = setTimeout(connectRealtime, 3000);
      }
    };
  }

  function disconnectRealtime() {
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
    if (state.realtimeSource) {
      state.realtimeSource.close();
      state.realtimeSource = null;
    }
  }

  function handleRealtimeEvent(evt) {
    if (!evt || evt.type === 'ping' || evt.type === 'connected') return;
    if (evt.type === 'message.created' && evt.message) {
      var m = evt.message;
      if (state.seenIds[m.id]) return;
      state.seenIds[m.id] = true;
      if (m.sender_type === 'system') addBubble('sys', m.content_text || '', m.id);
      else { addBubble('them', m.content_text || '', m.id); state.botAnswered = true; }
      // The event carries the message row's text and nothing else, so an agent
      // sending a file arrives here as its fallback line. Ask for the files a
      // moment later and swap the bubble over if this was one.
      scheduleAttachmentSync();
      if (m.created_at && (!state.lastTimestamp || m.created_at > state.lastTimestamp)) {
        state.lastTimestamp = m.created_at;
        lsSet('after', state.lastTimestamp);
      }
      return;
    }
    if (evt.type === 'conversation.updated') {
      if (evt.status === 'human_active') addBubble('sys', 'A human agent is now handling this chat.');
      if (evt.status === 'closed') {
        addBubble('sys', 'This chat has been closed.');
        // Agent/system closed the chat: ask for a rating inline (window stays open).
        if (shouldPromptCsat()) renderCsat();
      }
    }
  }

  // ---- CSAT (post-conversation rating) --------------------------------------
  function shouldPromptCsat() {
    return (
      state.csatEnabled &&
      state.botAnswered &&
      !!conversationId &&
      !state.csatDone &&
      !state.csatPrompted &&
      lsGet('csat:' + conversationId) !== '1'
    );
  }

  function renderCsat() {
    state.csatPrompted = true;
    state.csatRating = 0;
    var box = document.createElement('div');
    box.className = P + 'csat';

    var title = document.createElement('div');
    title.className = P + 'csat-title';
    title.textContent = state.csatPrompt || 'How would you rate this conversation?';
    box.appendChild(title);

    var stars = document.createElement('div');
    stars.className = P + 'stars';
    var starEls = [];
    function paint(value) {
      for (var i = 0; i < starEls.length; i++) {
        if (i < value) starEls[i].classList.add(P + 'on');
        else starEls[i].classList.remove(P + 'on');
      }
    }
    for (var s = 1; s <= 5; s++) {
      (function (value) {
        var star = document.createElement('button');
        star.type = 'button';
        star.className = P + 'star';
        star.setAttribute('aria-label', value + ' star' + (value > 1 ? 's' : ''));
        star.textContent = '★'; // ★
        star.addEventListener('mouseenter', function () { paint(value); });
        star.addEventListener('click', function () {
          state.csatRating = value;
          paint(value);
          submit.disabled = false;
        });
        stars.appendChild(star);
        starEls.push(star);
      })(s);
    }
    stars.addEventListener('mouseleave', function () { paint(state.csatRating); });
    box.appendChild(stars);

    var comment = null;
    if (state.csatCommentEnabled) {
      comment = document.createElement('textarea');
      comment.setAttribute('placeholder', state.rtl ? '...' : 'Add a comment (optional)');
      box.appendChild(comment);
    }

    var row = document.createElement('div');
    row.className = P + 'csat-row';
    var submit = document.createElement('button');
    submit.type = 'button';
    submit.className = P + 'csat-submit';
    submit.textContent = state.rtl ? 'إرسال' : 'Submit';
    submit.disabled = true;
    var skip = document.createElement('button');
    skip.type = 'button';
    skip.className = P + 'csat-skip';
    skip.textContent = state.rtl ? 'تخطي' : 'Skip';
    row.appendChild(submit);
    row.appendChild(skip);
    box.appendChild(row);

    var rowEl = appendRow('them', box);

    function finish(closeAfter) {
      state.csatDone = true;
      state.csatPrompted = false;
      if (conversationId) lsSet('csat:' + conversationId, '1');
      if (rowEl && rowEl.parentNode) rowEl.parentNode.removeChild(rowEl);
      if (closeAfter && state.open) closeWidget();
    }

    skip.addEventListener('click', function () { finish(true); });
    submit.addEventListener('click', function () {
      if (!state.csatRating) return;
      submit.disabled = true;
      submitCsat(state.csatRating, comment ? comment.value : '', function (ok) {
        if (ok) {
          finish(false);
          addBubble('sys', state.csatThanks || 'Thanks for your feedback!');
        } else {
          submit.disabled = false;
          addBubble('sys', 'Sorry, we could not save your rating. Please try again.');
        }
      });
    });
  }

  function submitCsat(rating, comment, cb) {
    if (!conversationId) { cb(false); return; }
    fetch(cfg.api + '/api/widget/csat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicBotId: cfg.botId,
        visitorId: visitorId,
        conversationId: conversationId,
        rating: rating,
        comment: comment || undefined
      })
    })
      .then(function (res) { cb(res.ok); })
      .catch(function () { cb(false); });
  }

  // ---- Opening hours, contact capture & transcript restore ------------------

  // Only an explicit `false` counts as closed. `null` means the company never
  // filled its opening hours in, and a blank form must never be the reason a
  // visitor is told nobody is here.
  function isClosedNow() {
    return state.hours.isOpenNow === false;
  }

  function statusText() {
    return isClosedNow()
      ? state.offlineLabel || 'Replying soon'
      : state.onlineLabel || 'Team is replying - live';
  }

  // While the pre-chat form is up the message box is disabled, so the form is
  // the only way forward and there is no race between the two.
  function setComposerLocked(on) {
    state.composerLocked = on;
    if (!els.input || !els.send) return;
    els.input.disabled = on || state.sending;
    els.send.disabled = on || state.sending;
    // The paperclip is a way into the conversation too, so a gate that only
    // shut the message box would be a gate with a door beside it.
    if (els.attach) els.attach.disabled = on || state.sending || state.uploading;
    var idle = state.rtl ? '...' : 'Type your message...';
    var locked = state.rtl ? '...' : 'Fill in the short form above to start';
    els.input.setAttribute('placeholder', on ? locked : idle);
    // The quick action pills start conversations too, so a gate that only
    // disabled the message box would be a gate with a door beside it.
    if (els.actions) {
      if (on) els.actions.style.display = 'none';
      else renderQuickActions();
    }
  }

  function maybeRenderGate() {
    if (state.gateRow) return;
    // Never before the transcript is back. The restore is what says whether
    // this visitor already gave their details, and a gate rendered first would
    // both sit above the history and lock the box for someone who has already
    // answered it.
    if (!state.restored) return;
    if (state.prechat.enabled && !state.prechatDone && lsGet('prechatSkipped') !== '1') {
      renderContactCard('prechat');
      return;
    }
    setComposerLocked(false);
    maybeShowOfflineNotice();
  }

  // Say the company is shut, then offer to take a message. Offering rather than
  // opening the form outright: a visitor who only wanted the opening times has
  // their answer and does not need a form in the way of it.
  function maybeShowOfflineNotice() {
    if (state.offlineShown || !isClosedNow() || !state.hours.offlineEnabled) return;
    state.offlineShown = true;
    if (els.status) els.status.textContent = statusText();

    var box = document.createElement('div');
    box.className = P + 'closed';
    var text = document.createElement('div');
    text.textContent = state.hours.offlineMessage;
    box.appendChild(text);

    if (state.hours.offlineFormEnabled) {
      var row = document.createElement('div');
      row.className = P + 'gate-row';
      row.style.marginTop = '10px';
      var open = document.createElement('button');
      open.type = 'button';
      open.className = P + 'gate-submit';
      open.textContent = state.hours.offlineButtonLabel || 'Leave a message';
      open.addEventListener('click', function () {
        if (row.parentNode) row.parentNode.removeChild(row);
        renderContactCard('offline');
      });
      row.appendChild(open);
      box.appendChild(row);
    }
    appendRow('them', box);
  }

  function contactFields(mode) {
    var fields = [];
    if (mode === 'offline') {
      // A message with no way to answer it is not a message. Name is optional,
      // a reply address and the question itself are not.
      fields.push({ name: 'name', label: 'Name', type: 'text', required: false });
      fields.push({ name: 'email', label: 'Email', type: 'email', required: true });
      fields.push({ name: 'message', label: 'Message', type: 'textarea', required: true });
      return fields;
    }
    var must = state.prechat.required;
    if (state.prechat.askName) fields.push({ name: 'name', label: 'Name', type: 'text', required: must });
    if (state.prechat.askEmail) fields.push({ name: 'email', label: 'Email', type: 'email', required: must });
    if (state.prechat.askPhone) fields.push({ name: 'phone', label: 'Phone', type: 'tel', required: must });
    return fields;
  }

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  // One card for both moments — the pre-chat gate and the out-of-hours message
  // form. They ask for the same things and post to the same endpoint; the only
  // real difference is whether the chat is blocked behind it.
  function renderContactCard(mode) {
    if (state.gateRow) return;
    var isPrechat = mode === 'prechat';
    var box = document.createElement('div');
    box.className = P + 'gate';
    var headingId = P + 'gate-' + Math.random().toString(36).slice(2, 9);
    box.setAttribute('role', 'group');
    box.setAttribute('aria-labelledby', headingId);

    var title = document.createElement('div');
    title.className = P + 'gate-title';
    title.id = headingId;
    title.textContent = isPrechat
      ? state.prechat.title || 'Before we start'
      : state.hours.offlineButtonLabel || 'Leave a message';
    box.appendChild(title);

    var intro = document.createElement('div');
    intro.className = P + 'gate-intro';
    intro.textContent = isPrechat
      ? state.prechat.intro || ''
      : 'Leave your details and your question, and we will reply when we are back.';
    if (intro.textContent) box.appendChild(intro);

    var inputs = [];
    contactFields(mode).forEach(function (field) {
      var wrap = createFieldRow(field);
      box.appendChild(wrap);
      var el = wrap.querySelector('input,textarea,select');
      if (el) inputs.push({ name: field.name, el: el, required: field.required, label: field.label });
    });

    var err = document.createElement('div');
    err.className = P + 'gate-error';
    err.setAttribute('role', 'alert');
    err.style.display = 'none';
    box.appendChild(err);

    var row = document.createElement('div');
    row.className = P + 'gate-row';
    var submit = document.createElement('button');
    submit.type = 'button';
    submit.className = P + 'gate-submit';
    submit.textContent = isPrechat ? state.prechat.buttonLabel || 'Start chat' : 'Send message';
    row.appendChild(submit);
    var skip = null;
    if (!isPrechat || state.prechat.allowSkip) {
      skip = document.createElement('button');
      skip.type = 'button';
      skip.className = P + 'gate-skip';
      skip.textContent = isPrechat ? 'Skip' : 'Cancel';
      row.appendChild(skip);
    }
    box.appendChild(row);

    state.gateRow = appendRow('them', box);
    if (isPrechat) setComposerLocked(true);
    scrollDown(true);

    function showError(message) {
      err.textContent = message;
      err.style.display = 'block';
    }

    function dismiss() {
      if (state.gateRow && state.gateRow.parentNode) state.gateRow.parentNode.removeChild(state.gateRow);
      state.gateRow = null;
      setComposerLocked(false);
    }

    function markPrechatSettled() {
      state.prechatDone = true;
      if (conversationId) lsSet('prechat:' + conversationId, '1');
    }

    function attempt() {
      var values = {};
      var missing = null;
      for (var i = 0; i < inputs.length; i++) {
        var value = String(inputs[i].el.value || '').trim();
        if (!value) {
          if (inputs[i].required && !missing) missing = inputs[i];
          continue;
        }
        values[inputs[i].name] = value;
      }
      if (missing) {
        showError('Please fill in ' + missing.label.toLowerCase() + '.');
        try { missing.el.focus(); } catch (e) {}
        return;
      }
      if (values.email && !EMAIL_RE.test(values.email)) {
        showError('That email address does not look right.');
        return;
      }
      err.style.display = 'none';
      submit.disabled = true;
      submitContact(mode, values, function (ok, message) {
        submit.disabled = false;
        if (!ok) {
          showError(message || 'Sorry, we could not send that. Please try again.');
          return;
        }
        dismiss();
        if (isPrechat) {
          markPrechatSettled();
          maybeShowOfflineNotice();
          if (els.input) els.input.focus();
        } else {
          addBubble('sys', message || 'Thanks. We have your message.');
        }
      });
    }

    if (skip) {
      skip.addEventListener('click', function () {
        dismiss();
        if (isPrechat) {
          markPrechatSettled();
          // Remembered against the visitor, not the conversation: someone who
          // has already declined once should not be asked again on their next
          // question, and a skipped gate often has no conversation id yet.
          lsSet('prechatSkipped', '1');
          maybeShowOfflineNotice();
        }
        focusFirst();
      });
    }
    submit.addEventListener('click', attempt);
    inputs.forEach(function (field) {
      field.el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && field.el.tagName !== 'TEXTAREA') {
          e.preventDefault();
          attempt();
        }
      });
    });
  }

  function submitContact(mode, values, cb) {
    fetch(cfg.api + '/api/widget/prechat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicBotId: cfg.botId,
        visitorId: visitorId,
        conversationId: conversationId || undefined,
        mode: mode,
        name: values.name,
        email: values.email,
        phone: values.phone,
        message: values.message,
        pageUrl: window.location.href
      })
    })
      .then(function (res) {
        return res
          .json()
          .catch(function () { return {}; })
          .then(function (data) { return { ok: res.ok, data: data || {} }; });
      })
      .then(function (result) {
        if (result.ok && result.data.conversationId) {
          conversationId = result.data.conversationId;
          lsSet('conversationId', conversationId);
          connectRealtime();
        }
        if (!result.ok) {
          reportClientError('Widget contact capture rejected', {
            error: result.data.error || 'unknown',
            mode: mode
          });
        }
        cb(result.ok, result.data.message || null);
      })
      .catch(function (err) {
        reportClientError('Widget contact capture failed', {
          error: err && err.message ? err.message : String(err),
          mode: mode
        });
        cb(false, null);
      });
  }

  // Put the conversation back after a refresh.
  //
  // Without this a reload showed an empty window with a live conversation id
  // behind it — one customer filled the same enquiry form twice and created two
  // conversations, because as far as they could see nothing had happened.
  function restoreTranscript(cb) {
    function finish() {
      state.restored = true;
      if (cb) cb();
    }
    if (state.restored || !conversationId) {
      finish();
      return;
    }
    var url =
      cfg.api +
      '/api/widget/transcript?publicBotId=' +
      encodeURIComponent(cfg.botId) +
      '&conversationId=' +
      encodeURIComponent(conversationId) +
      '&visitorId=' +
      encodeURIComponent(visitorId);
    fetch(url)
      .then(function (res) {
        if (res.status === 403 || res.status === 404) {
          // The stored id no longer resolves — retention deleted the chat, or
          // this browser profile belongs to someone else now. Forget it and
          // start a fresh conversation rather than sitting on a dead one.
          conversationId = null;
          lsDel('conversationId');
          lsDel('after');
          return null;
        }
        if (!res.ok) throw new Error('transcript_' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!data) return;
        if (data.contactCaptured) state.prechatDone = true;
        var messages = data.messages || [];
        for (var i = 0; i < messages.length; i++) {
          var m = messages[i];
          if (!m || state.seenIds[m.id]) continue;
          state.seenIds[m.id] = true;
          if (m.senderType === 'visitor') addBubble('me', m.text, m.id);
          else if (m.senderType === 'system') addBubble('sys', m.text, m.id);
          else {
            addBubble('them', m.text, m.id);
            state.botAnswered = true;
          }
        }
        // Any of those bubbles may be a file. The transcript endpoint returns
        // the message text only, so the files are fetched separately and
        // dropped into the bubbles that are now on screen.
        if (messages.length) {
          // A conversation already under way must not be greeted again — the
          // welcome would land underneath the answer it already gave.
          state.welcomed = true;
          scrollDown(true);
          syncAttachments();
        }
        if (data.lastMessageAt) {
          state.lastTimestamp = data.lastMessageAt;
          lsSet('after', data.lastMessageAt);
        }
      })
      .catch(function (err) {
        reportClientError('Widget transcript restore failed', {
          error: err && err.message ? err.message : String(err)
        });
      })
      .then(finish);
  }

  // ---- Send + SSE stream ----------------------------------------------------
  function setSending(on) {
    state.sending = on;
    // The pre-chat gate outranks the send state: finishing a request must not
    // re-enable a message box the form is still holding shut.
    els.send.disabled = on || state.composerLocked;
    els.input.disabled = on || state.composerLocked;
    if (els.attach) els.attach.disabled = on || state.composerLocked || state.uploading;
  }

  function onSend() {
    if (state.sending || state.composerLocked) return;
    var text = (els.input.value || '').trim();
    if (!text) return;
    els.input.value = '';
    addBubble('me', text);
    sendMessage(text);
  }

  function sendMessage(text) {
    setSending(true);
    state.currentBotBubble = null;
    showTyping();

    var payload = { publicBotId: cfg.botId, visitorId: visitorId, text: text };
    if (conversationId) payload.conversationId = conversationId;

    fetch(cfg.api + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        if (!res.ok || !res.body) {
          return res.text().then(function (body) {
            var code = 'bad_response_' + res.status;
            try {
              var parsed = JSON.parse(body || '{}');
              if (parsed && parsed.error) code = parsed.error;
            } catch (e) {}
            throw new Error(code);
          });
        }
        return consumeStream(res.body.getReader());
      })
      .catch(function (err) {
        hideTyping();
        reportClientError('Widget chat request failed', { error: err && err.message ? err.message : String(err) });
        if (!state.currentBotBubble) {
          addBubble('them', friendlyErrorMessage(err));
        }
      })
      .then(function () {
        setSending(false);
        els.input.focus();
      });
  }

  function friendlyErrorMessage(err) {
    var code = err && err.message ? String(err.message) : '';
    if (code === 'domain_not_allowed') {
      return 'This website is not enabled for the assistant yet. Please add this domain in the widget settings.';
    }
    if (code === 'bot_not_found') {
      return 'This assistant is not available. Please check the widget embed code.';
    }
    if (code === 'internal_assistant_not_available_on_widget') {
      return 'This assistant is for internal help desk use and cannot be used on the customer website widget.';
    }
    if (code === 'rate_limited') {
      return 'Too many messages were sent quickly. Please try again in a moment.';
    }
    return 'Sorry, something went wrong. Please try again.';
  }

  function consumeStream(reader) {
    var decoder = new TextDecoder();
    var buffer = '';

    function pump() {
      return reader.read().then(function (result) {
        if (result.value) buffer += decoder.decode(result.value, { stream: true });

        var idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          var block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          handleBlock(block);
        }

        if (result.done) {
          if (buffer.trim()) handleBlock(buffer);
          return;
        }
        return pump();
      });
    }
    return pump();
  }

  function handleBlock(block) {
    var lines = block.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.indexOf('data:') !== 0) continue;
      var raw = line.slice(5).trim();
      if (!raw) continue;
      var evt;
      try {
        evt = JSON.parse(raw);
      } catch (e) {
        continue;
      }
      handleEvent(evt);
    }
  }

  function handleEvent(evt) {
    switch (evt.type) {
      case 'meta':
        if (evt.conversationId) {
          conversationId = evt.conversationId;
          lsSet('conversationId', conversationId);
          connectRealtime();
        }
        if (evt.language === 'ar' && cfg.lang === 'auto') setRtl(true);
        break;
      case 'status':
        // Live progress ("Searching…", "Checking your order…") shown until the
        // first answer token arrives.
        if (!state.currentBotBubble) updateTypingLabel(evt.value);
        break;
      case 'token':
        // Dots disappear the moment text starts, then the answer types itself
        // out word-by-word via the typewriter buffer (twPush) instead of being
        // dumped in all at once.
        hideTyping();
        if (!state.currentBotBubble) {
          state.currentBotBubble = addBubble('them', '');
          twReset(state.currentBotBubble);
        }
        twPush(evt.value != null ? evt.value : '');
        break;
      case 'sources':
        // Where the answer came from. Sent after the last token and before
        // 'done', and only when the assistant actually answered from retrieved
        // material — a "sorry, I don't know" never carries sources, because
        // listing them under a non-answer implies they contained something.
        twFlush();
        try { renderSources(evt.sources); } catch (e) {}
        break;
      case 'action':
        // The bot asked the widget to render a UI element (form / quick replies
        // / product cards / fallback CTA) inline in the conversation.
        hideTyping();
        twFlush(); // show any buffered text before the inline UI appears
        state.currentBotBubble = null;
        try { renderInlineAction(evt); } catch (e) {}
        break;
      case 'human':
        hideTyping();
        twFlush();
        addBubble('sys', 'An agent will reply shortly.');
        connectRealtime();
        break;
      case 'error':
        hideTyping();
        twFlush();
        addBubble('them', evt.value || 'Sorry, something went wrong.');
        state.currentBotBubble = null;
        break;
      case 'done':
        // Don't flush - let the typewriter finish revealing naturally. Config
        // refresh (quick actions) can happen while the last words type out.
        hideTyping();
        state.currentBotBubble = null;
        state.botAnswered = true; // a reply landed → conversation is rateable
        loadWidgetConfig('after_answer');
        break;
    }
  }

  function onActionFormSubmit(e) {
    e.preventDefault();
    if (!state.activeForm) return;
    var action = state.activeForm;
    var values = collectFormValues(els.form);
    setSending(true);
    logQuickAction(action, values)
      .then(function (data) {
        closeActionForm();
        addBubble('sys', data.message || 'Thanks. Your details were sent.');
      })
      .catch(function () {
        addBubble('sys', 'Sorry, we could not submit that. Please try again.');
      })
      .then(function () {
        setSending(false);
      });
  }

  // ---- Inline AI-driven actions (forms / quick replies / cards / CTA) -------
  var DEFAULT_INLINE_FIELDS = [
    { name: 'name', label: 'Name', type: 'text', required: true },
    { name: 'phone', label: 'Phone', type: 'tel', required: true },
    { name: 'email', label: 'Email', type: 'email' }
  ];

  function renderInlineAction(evt) {
    var action = evt.action;
    var payload = evt.payload || {};
    if (action === 'quick_replies') return renderQuickReplyChips(payload);
    if (action === 'product_cards') return renderProductCards(payload);
    if (action === 'fallback_cta') return renderFallbackCta(payload);
    // Form-type actions: lead_form, appointment_form, human_handoff.
    return renderInlineForm(action, payload);
  }

  function submitInlineAction(actionId, values, cb) {
    if (!actionId) { cb(false); return; }
    logQuickAction({ id: actionId }, values)
      .then(function (data) { cb(true, data && data.message); })
      .catch(function () { cb(false); });
  }

  function renderInlineForm(uiAction, payload) {
    payload = payload || {};
    var form = document.createElement('form');
    form.className = P + 'inline-form';
    if (payload.title) {
      var t = document.createElement('div');
      t.className = P + 'form-title';
      t.textContent = payload.title;
      form.appendChild(t);
    }
    if (payload.description) {
      var d = document.createElement('div');
      d.className = P + 'form-desc';
      d.textContent = payload.description;
      form.appendChild(d);
    }
    var fields = payload.fields && payload.fields.length ? payload.fields : DEFAULT_INLINE_FIELDS;
    fields.forEach(function (f) { form.appendChild(createFieldRow(f)); });

    var btnRow = document.createElement('div');
    btnRow.className = P + 'form-row';
    var submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = P + 'form-submit';
    submit.textContent = payload.submitLabel || 'Send';
    btnRow.appendChild(submit);
    form.appendChild(btnRow);

    var row = appendRow('them', form);
    form.addEventListener('submit', function (e) {
      e.preventDefault(); // Native required validation already gates this handler.
      var values = collectFormValues(form);
      submit.disabled = true;
      submitInlineAction(payload.actionId, values, function (ok, message) {
        if (ok) {
          if (row.parentNode) row.parentNode.removeChild(row);
          addBubble('sys', message || 'Thanks. Your details were sent.');
        } else {
          submit.disabled = false;
          addBubble('sys', 'Sorry, we could not submit that. Please try again.');
        }
      });
    });
    var first = form.querySelector('input,textarea,select');
    if (first) { try { first.focus(); } catch (e) {} }
  }

  /**
   * The sources under an answer.
   *
   * Deliberately quiet: small, muted, and collapsed to the titles. It answers
   * "where did that come from" for the one visitor in twenty who asks, without
   * turning every reply into a bibliography. A source with a URL is a link; one
   * from an uploaded file is plain text, because there is nothing to open.
   */
  function renderSources(sources) {
    if (!sources || !sources.length) return;
    var wrap = document.createElement('div');
    wrap.className = P + 'sources';

    var label = document.createElement('div');
    label.className = P + 'sources-label';
    label.textContent = state.rtl ? 'المصادر' : 'Based on';
    wrap.appendChild(label);

    var list = document.createElement('div');
    list.className = P + 'sources-list';
    sources.forEach(function (src) {
      if (!src || !src.title) return;
      var item;
      if (src.url) {
        item = document.createElement('a');
        item.href = src.url;
        item.target = '_blank';
        item.rel = 'noopener noreferrer';
      } else {
        item = document.createElement('span');
      }
      item.className = P + 'source';
      item.textContent = src.title;
      if (src.snippet) item.title = src.snippet;
      list.appendChild(item);
    });
    if (!list.childNodes.length) return;
    wrap.appendChild(list);
    appendRow('them', wrap);
  }

  function renderQuickReplyChips(payload) {
    var options = (payload && payload.options) || [];
    if (!options.length) return;
    var wrap = document.createElement('div');
    wrap.className = P + 'chips';
    var row;
    options.forEach(function (opt) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = P + 'chip';
      b.textContent = opt;
      b.addEventListener('click', function () {
        if (state.sending) return;
        if (row && row.parentNode) row.parentNode.removeChild(row);
        addBubble('me', opt);
        sendMessage(opt);
      });
      wrap.appendChild(b);
    });
    row = appendRow('them', wrap);
  }

  function formatPrice(price, currency) {
    if (price == null || price === '') return '';
    var n = Number(price);
    var s = isFinite(n) ? String(Math.round(n * 100) / 100) : String(price);
    return currency ? currency + ' ' + s : s;
  }

  function renderProductCards(payload) {
    var products = (payload && payload.products) || [];
    if (!products.length) return;
    var wrap = document.createElement('div');
    wrap.className = P + 'cards';
    products.forEach(function (p) {
      var card = document.createElement('div');
      card.className = P + 'card';
      var title = document.createElement('div');
      title.className = P + 'card-title';
      title.textContent = p.title || 'Product';
      card.appendChild(title);
      if (p.description) {
        var ds = document.createElement('div');
        ds.className = P + 'card-desc';
        ds.textContent = p.description;
        card.appendChild(ds);
      }
      var meta = document.createElement('div');
      meta.className = P + 'card-meta';
      var priceStr = formatPrice(p.price, p.currency);
      if (priceStr) {
        var pr = document.createElement('span');
        pr.className = P + 'card-price';
        pr.textContent = priceStr;
        meta.appendChild(pr);
      }
      var stock = document.createElement('span');
      if (p.inStock === true) { stock.className = P + 'card-stock ' + P + 'stk-in'; stock.textContent = 'In stock'; }
      else if (p.inStock === false) { stock.className = P + 'card-stock ' + P + 'stk-out'; stock.textContent = 'Out of stock'; }
      else { stock.className = P + 'card-stock ' + P + 'stk-unk'; stock.textContent = 'Check with team'; }
      meta.appendChild(stock);
      if (p.sku) {
        var sku = document.createElement('span');
        sku.className = P + 'card-desc';
        sku.textContent = 'SKU: ' + p.sku;
        meta.appendChild(sku);
      }
      card.appendChild(meta);
      var acts = document.createElement('div');
      acts.className = P + 'card-actions';
      var ask = document.createElement('button');
      ask.type = 'button';
      ask.className = P + 'card-btn';
      ask.textContent = 'Ask about this';
      ask.addEventListener('click', function () {
        if (state.sending) return;
        var q = 'Tell me more about ' + (p.title || 'this product');
        addBubble('me', q);
        sendMessage(q);
      });
      acts.appendChild(ask);
      card.appendChild(acts);
      wrap.appendChild(card);
    });
    appendRow('them', wrap);
  }

  function intentToActionType(kind) {
    if (kind === 'lead_form') return 'lead_form';
    if (kind === 'appointment_form') return 'appointment_form';
    if (kind === 'human_handoff') return 'request_human';
    return null;
  }

  function findQuickAction(actionType) {
    var list = state.quickActions || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].actionType === actionType) return list[i];
    }
    return null;
  }

  function openIntentForm(kind) {
    var at = intentToActionType(kind);
    var qa = at ? findQuickAction(at) : null;
    if (qa) {
      renderInlineForm(kind, {
        actionId: qa.id,
        title: qa.label,
        description: qa.description,
        fields: qa.formSchema
      });
      return;
    }
    // No configured form — nudge the bot to handle it conversationally.
    var msg = kind === 'human_handoff' ? 'I would like to talk to a human.' : 'Please have the team contact me.';
    addBubble('me', msg);
    sendMessage(msg);
  }

  function renderFallbackCta(payload) {
    payload = payload || {};
    var box = document.createElement('div');
    box.className = P + 'cta';
    var msg = document.createElement('div');
    msg.className = P + 'cta-msg';
    msg.textContent = payload.message || 'Would you like the team to contact you?';
    box.appendChild(msg);
    var ctaRow = document.createElement('div');
    ctaRow.className = P + 'cta-row';
    var row;
    (payload.actions || []).forEach(function (a, idx) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = P + 'cta-btn' + (idx > 0 ? ' ' + P + 'ghost' : '');
      b.textContent = a.label || a.kind;
      b.addEventListener('click', function () {
        if (row && row.parentNode) row.parentNode.removeChild(row);
        openIntentForm(a.kind);
      });
      ctaRow.appendChild(b);
    });
    box.appendChild(ctaRow);
    row = appendRow('them', box);
  }

  // ---- Boot -----------------------------------------------------------------
  // Watch the document for our host being removed and re-attach it. A
  // MutationObserver fires only on real DOM changes, so this is idle-cheap.
  function keepMounted() {
    if (!host || !window.MutationObserver) return;
    var mount = document.documentElement || document.body;
    var obs = new MutationObserver(function () {
      if (host && !host.isConnected) {
        try { (document.documentElement || document.body).appendChild(host); } catch (e) {}
      }
    });
    try { obs.observe(mount, { childList: true }); } catch (e) {}
  }

  function init() {
    buildDom();
    els.form.addEventListener('submit', onActionFormSubmit);
    window.addEventListener('resize', applyWidgetAppearance);
    // Self-heal: some SPA / page-builder navigations wipe nodes they don't own.
    // If our host gets detached, put it back so the launcher never disappears
    // for good ("comes and goes"). Cheap: only acts when host is disconnected.
    keepMounted();
    // Track the on-screen keyboard / viewport changes on mobile so the input
    // never ends up hidden behind the keyboard.
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', applyMobileViewport);
      window.visualViewport.addEventListener('scroll', applyMobileViewport);
    }
    loadWidgetConfig('initial');
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
