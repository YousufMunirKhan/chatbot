/*!
 * Embeddable Website Chat Widget (Module 8)
 * Vanilla JS, no build step, no dependencies. Served as a static asset.
 *
 * This widget contains NO business logic. It only sends/receives messages
 * via the backend API (POST /api/chat SSE stream + GET /api/chat/realtime
 * realtime stream). All AI logic lives server-side.
 *
 * Configure via data-* attributes on the <script> tag:
 *   data-bot-id   (REQUIRED) public bot id
 *   data-api      API base URL (default: origin of this script's src)
 *   data-color    primary color (default #2563eb)
 *   data-position right | left (default right)
 *   data-title    header title (default "Chat with us")
 *   data-welcome  welcome message (default "Hi! How can I help you today?")
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
    color: script.getAttribute('data-color') || '#2563eb',
    position: script.getAttribute('data-position') === 'left' ? 'left' : 'right',
    title: script.getAttribute('data-title') || 'Chat with us',
    welcome: script.getAttribute('data-welcome') || 'Hi! How can I help you today?',
    lang: script.getAttribute('data-lang') || 'auto',
    autoOpen: script.getAttribute('data-auto-open') === 'true',
    autoOpenDelaySeconds: Number(script.getAttribute('data-auto-open-delay') || 3)
  };

  // ---- Storage helpers ------------------------------------------------------
  var NS = 'aiba:' + cfg.botId + ':';
  function lsGet(key) {
    try { return window.localStorage.getItem(NS + key); } catch (e) { return null; }
  }
  function lsSet(key, val) {
    try { window.localStorage.setItem(NS + key, val); } catch (e) {}
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
    agentLabel: 'AI Assistant',
    agentAvatarUrl: null,
    launcherIcon: 'chat',
    onlineLabel: 'Online now',
    offlineLabel: 'Replying soon',
    typingLabel: 'Assistant is typing',
    footerBranding: null,
    proactiveMessage: null,
    autoOpen: cfg.autoOpen,
    autoOpenOnce: true,
    autoOpenDelaySeconds: cfg.autoOpenDelaySeconds,
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
    autoOpenTimer: null
  };

  // ---- Styles ---------------------------------------------------------------
  var P = 'aiba-';
  function injectStyles() {
    var css = [
      '.' + P + 'root,.' + P + 'root *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}',
      '.' + P + 'launcher{position:fixed;bottom:20px;z-index:2147483000;width:60px;height:60px;border-radius:50%;border:none;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25);background:' + cfg.color + ';color:#fff;display:flex;align-items:center;justify-content:center;transition:transform .15s ease}',
      '.' + P + 'launcher.' + P + 'pill{width:auto;min-width:64px;padding:0 16px;border-radius:999px;gap:8px;font-size:14px;font-weight:600}',
      '.' + P + 'launcher-label{display:none}',
      '.' + P + 'pill .' + P + 'launcher-label{display:inline}',
      '.' + P + 'launcher:hover{transform:scale(1.06)}',
      '.' + P + 'launcher svg{width:28px;height:28px;fill:#fff}',
      '.' + P + 'pos-right{right:20px}',
      '.' + P + 'pos-left{left:20px}',
      '.' + P + 'window{position:fixed;bottom:90px;z-index:2147483000;width:360px;height:520px;max-height:calc(100vh - 110px);background:#fff;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.22);display:none;flex-direction:column;overflow:hidden}',
      '.' + P + 'window.' + P + 'show{display:flex}',
      '.' + P + 'header{background:' + cfg.color + ';color:#fff;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;flex:0 0 auto}',
      '.' + P + 'header h3{margin:0;font-size:15px;font-weight:600;line-height:1.2}',
      '.' + P + 'status{font-size:11px;opacity:.85;margin-top:2px}',
      '.' + P + 'close{background:none;border:none;color:#fff;font-size:22px;line-height:1;cursor:pointer;padding:0 4px;opacity:.9}',
      '.' + P + 'close:hover{opacity:1}',
      '.' + P + 'msgs{flex:1 1 auto;overflow-y:auto;padding:14px;background:#f7f8fa;display:flex;flex-direction:column;gap:8px}',
      '.' + P + 'row{display:flex;width:100%}',
      '.' + P + 'row.' + P + 'me{justify-content:flex-end}',
      '.' + P + 'row.' + P + 'them{justify-content:flex-start}',
      '.' + P + 'row.' + P + 'sys{justify-content:center}',
      '.' + P + 'avatar{width:24px;height:24px;border-radius:50%;background:' + cfg.color + ';color:#fff;display:none;align-items:center;justify-content:center;font-size:11px;font-weight:700;margin-right:6px;align-self:flex-end;overflow:hidden;flex:0 0 auto}',
      '.' + P + 'avatar img{width:100%;height:100%;object-fit:cover}',
      '.' + P + 'them .' + P + 'avatar{display:flex}',
      '.' + P + 'bubble{max-width:80%;padding:9px 12px;border-radius:14px;font-size:14px;line-height:1.4;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:anywhere}',
      '.' + P + 'me .' + P + 'bubble{background:' + cfg.color + ';color:#fff;border-bottom-right-radius:4px}',
      '.' + P + 'them .' + P + 'bubble{background:#e9ebef;color:#1a1a1a;border-bottom-left-radius:4px}',
      '.' + P + 'sys .' + P + 'bubble{background:transparent;color:#888;font-size:12px;text-align:center;max-width:100%}',
      '.' + P + 'bubble strong{font-weight:600}',
      '.' + P + 'bubble a{color:inherit;text-decoration:underline}',
      '.' + P + 'bubble code{background:rgba(0,0,0,.06);border-radius:4px;padding:1px 4px;font-size:90%;font-family:ui-monospace,Menlo,Consolas,monospace}',
      '.' + P + 'hr{display:block;border-top:1px solid rgba(0,0,0,.15);margin:6px 0}',
      '.' + P + 'tablewrap{overflow-x:auto;margin:6px 0;-webkit-overflow-scrolling:touch}',
      '.' + P + 'table{border-collapse:collapse;font-size:13px;width:100%}',
      '.' + P + 'table th,.' + P + 'table td{border:1px solid rgba(0,0,0,.12);padding:4px 8px;text-align:left;white-space:nowrap}',
      '.' + P + 'table th{background:rgba(0,0,0,.04);font-weight:600}',
      '.' + P + 'actions{flex:0 0 auto;display:flex;gap:8px;flex-wrap:wrap;padding:10px 12px;border-top:1px solid #eee;background:#fff;max-height:120px;overflow-y:auto}',
      '.' + P + 'action{border:1px solid #d9dce1;background:#fff;color:#374151;border-radius:999px;padding:8px 14px;font-size:13px;font-weight:500;line-height:1.2;cursor:pointer;max-width:100%;white-space:nowrap;text-align:center;transition:border-color .15s,color .15s,background .15s}',
      '.' + P + 'action:hover{border-color:' + cfg.color + ';color:' + cfg.color + ';background:#f8fafc}',
      '.' + P + 'form{flex:0 0 auto;border-top:1px solid #eee;background:#fff;padding:16px;display:none;gap:12px;flex-direction:column;max-height:78%;overflow-y:auto}',
      '.' + P + 'form.' + P + 'show{display:flex}',
      '.' + P + 'window.' + P + 'form-open .' + P + 'msgs,.' + P + 'window.' + P + 'form-open .' + P + 'actions,.' + P + 'window.' + P + 'form-open .' + P + 'footer{display:none}',
      '.' + P + 'window.' + P + 'form-open .' + P + 'form{flex:1 1 auto;max-height:none}',
      '.' + P + 'form-title{font-size:15px;font-weight:600;color:#111827}',
      '.' + P + 'form-desc{font-size:12px;color:#6b7280;margin-top:-6px}',
      '.' + P + 'field{display:flex;flex-direction:column;gap:5px}',
      '.' + P + 'field label{font-size:12px;font-weight:500;color:#374151}',
      '.' + P + 'field input,.' + P + 'field textarea,.' + P + 'field select{width:100%;border:1px solid #d6d9de;border-radius:8px;padding:10px 12px;font-size:14px;outline:none}',
      '.' + P + 'field input:focus,.' + P + 'field textarea:focus,.' + P + 'field select:focus{border-color:' + cfg.color + '}',
      '.' + P + 'field textarea{min-height:64px;resize:vertical}',
      '.' + P + 'form-row{display:flex;gap:8px;margin-top:2px}',
      '.' + P + 'form-submit{flex:1;border:none;background:' + cfg.color + ';color:#fff;border-radius:8px;padding:11px 14px;font-size:14px;font-weight:600;cursor:pointer}',
      '.' + P + 'form-submit:disabled{opacity:.6;cursor:not-allowed}',
      '.' + P + 'form-cancel{border:1px solid #d6d9de;background:#fff;color:#4b5563;border-radius:8px;padding:11px 16px;font-size:14px;cursor:pointer}',
      '.' + P + 'footer{flex:0 0 auto;display:flex;gap:8px;padding:10px;border-top:1px solid #eee;background:#fff}',
      '.' + P + 'input{flex:1 1 auto;border:1px solid #d6d9de;border-radius:20px;padding:9px 14px;font-size:14px;outline:none;resize:none}',
      '.' + P + 'input:focus{border-color:' + cfg.color + '}',
      '.' + P + 'send{flex:0 0 auto;border:none;background:' + cfg.color + ';color:#fff;width:40px;height:40px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center}',
      '.' + P + 'send:disabled{opacity:.5;cursor:not-allowed}',
      '.' + P + 'send svg{width:18px;height:18px;fill:#fff}',
      '.' + P + 'typing{display:flex;gap:4px;padding:11px 14px;background:#e9ebef;border-radius:14px;border-bottom-left-radius:4px;width:auto}',
      '.' + P + 'typing-label{font-size:12px;color:#6b7280;padding:0 4px 4px}',
      '.' + P + 'typing span{width:7px;height:7px;border-radius:50%;background:#9aa0a6;animation:' + P + 'blink 1.2s infinite both}',
      '.' + P + 'typing span:nth-child(2){animation-delay:.2s}',
      '.' + P + 'typing span:nth-child(3){animation-delay:.4s}',
      '.' + P + 'brand{flex:0 0 auto;padding:6px 10px;text-align:center;font-size:11px;color:#8a8f98;border-top:1px solid #eee;background:#fff}',
      // Inline AI-driven actions rendered in the message flow (forms, chips, cards, CTA).
      '.' + P + 'inline-form{max-width:92%;width:100%;background:#fff;border:1px solid #e3e6ea;border-radius:14px;border-bottom-left-radius:4px;padding:12px;display:flex;flex-direction:column;gap:10px}',
      '.' + P + 'inline-form .' + P + 'form-title{font-size:14px}',
      '.' + P + 'chips{display:flex;flex-wrap:wrap;gap:6px;width:100%;max-width:92%}',
      '.' + P + 'chip{border:1px solid ' + cfg.color + ';color:' + cfg.color + ';background:#fff;border-radius:999px;padding:7px 12px;font-size:13px;font-weight:500;cursor:pointer;line-height:1.25;max-width:100%;white-space:normal;text-align:left}',
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
      '.' + P + 'card-btn:hover{border-color:' + cfg.color + ';color:' + cfg.color + '}',
      '.' + P + 'cta{max-width:92%;width:100%;background:#fff;border:1px solid #e3e6ea;border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:8px}',
      '.' + P + 'cta-msg{font-size:13px;color:#374151;line-height:1.4}',
      '.' + P + 'cta-row{display:flex;gap:6px;flex-wrap:wrap}',
      '.' + P + 'cta-btn{border:none;background:' + cfg.color + ';color:#fff;border-radius:8px;padding:7px 12px;font-size:13px;font-weight:600;cursor:pointer}',
      '.' + P + 'cta-btn.' + P + 'ghost{background:#fff;color:' + cfg.color + ';border:1px solid ' + cfg.color + '}',
      '@keyframes ' + P + 'blink{0%,80%,100%{opacity:.3}40%{opacity:1}}',
      '.' + P + 'window[dir="rtl"] .' + P + 'me .' + P + 'bubble{border-bottom-right-radius:14px;border-bottom-left-radius:4px}',
      '.' + P + 'window[dir="rtl"] .' + P + 'them .' + P + 'bubble{border-bottom-left-radius:14px;border-bottom-right-radius:4px}',
      '@media (max-width:480px){.' + P + 'window{width:100%;height:100%;max-height:100%;bottom:0;left:0;right:0;border-radius:0}.' + P + 'window.' + P + 'mobile-sheet{height:74vh;max-height:74vh;bottom:0;top:auto;border-radius:16px 16px 0 0}.' + P + 'launcher{bottom:calc(16px + env(safe-area-inset-bottom))}}'
    ].join('');
    var style = document.createElement('style');
    style.setAttribute('data-aiba-widget', cfg.botId);
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ---- DOM build ------------------------------------------------------------
  var els = {};
  function buildDom() {
    var root = document.createElement('div');
    root.className = P + 'root';

    var launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.className = P + 'launcher ' + P + 'pos-' + cfg.position;
    launcher.setAttribute('aria-label', cfg.title);
    launcher.innerHTML = launcherSvg(state.launcherIcon) + '<span class="' + P + 'launcher-label">' + escapeHtml(cfg.title) + '</span>';

    var win = document.createElement('div');
    win.className = P + 'window ' + P + 'pos-' + cfg.position;
    if (state.rtl) win.setAttribute('dir', 'rtl');

    var header = document.createElement('div');
    header.className = P + 'header';
    var h3 = document.createElement('h3');
    h3.textContent = cfg.title;
    var titleWrap = document.createElement('div');
    var status = document.createElement('div');
    status.className = P + 'status';
    status.textContent = state.onlineLabel;
    var close = document.createElement('button');
    close.type = 'button';
    close.className = P + 'close';
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = '&times;';
    titleWrap.appendChild(h3);
    titleWrap.appendChild(status);
    header.appendChild(titleWrap);
    header.appendChild(close);

    var msgs = document.createElement('div');
    msgs.className = P + 'msgs';

    var actions = document.createElement('div');
    actions.className = P + 'actions';

    var form = document.createElement('form');
    form.className = P + 'form';
    var brand = document.createElement('div');
    brand.className = P + 'brand';
    brand.style.display = 'none';

    var footer = document.createElement('div');
    footer.className = P + 'footer';
    var input = document.createElement('input');
    input.className = P + 'input';
    input.type = 'text';
    input.setAttribute('placeholder', state.rtl ? '...' : 'Type a message');
    input.setAttribute('aria-label', 'Message');
    input.setAttribute('autocomplete', 'off');
    var send = document.createElement('button');
    send.type = 'button';
    send.className = P + 'send';
    send.setAttribute('aria-label', 'Send');
    send.innerHTML = '<svg viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>';
    footer.appendChild(input);
    footer.appendChild(send);

    win.appendChild(header);
    win.appendChild(msgs);
    win.appendChild(actions);
    win.appendChild(form);
    win.appendChild(brand);
    win.appendChild(footer);

    root.appendChild(launcher);
    root.appendChild(win);
    document.body.appendChild(root);

    els = { root: root, launcher: launcher, win: win, msgs: msgs, actions: actions, form: form, brand: brand, input: input, send: send, title: h3, status: status };
    applyWidgetAppearance();

    launcher.addEventListener('click', toggle);
    close.addEventListener('click', toggle);
    send.addEventListener('click', onSend);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        onSend();
      }
    });
  }

  // ---- Rendering ------------------------------------------------------------
  function addBubble(kind, text) {
    var row = document.createElement('div');
    row.className = P + 'row ' + P + kind; // me | them | sys
    var bubble = document.createElement('div');
    bubble.className = P + 'bubble';
    if (kind === 'them') bubble.innerHTML = renderMarkdown(text);
    else bubble.textContent = text;
    if (kind === 'them') {
      var avatar = document.createElement('div');
      avatar.className = P + 'avatar';
      avatar.title = state.agentLabel || 'AI Assistant';
      if (state.agentAvatarUrl) {
        var img = document.createElement('img');
        img.src = state.agentAvatarUrl;
        img.alt = '';
        avatar.appendChild(img);
      } else {
        avatar.textContent = (state.agentLabel || 'AI').slice(0, 2).toUpperCase();
      }
      row.appendChild(avatar);
    }
    row.appendChild(bubble);
    els.msgs.appendChild(row);
    scrollDown(kind === 'me'); // always follow the user's own message
    return bubble;
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
        if (!res.ok) throw new Error('config_' + res.status);
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
          state.launcherIcon = data.bot.launcherIcon || state.launcherIcon;
          state.onlineLabel = data.bot.onlineLabel || state.onlineLabel;
          state.offlineLabel = data.bot.offlineLabel || state.offlineLabel;
          state.typingLabel = data.bot.typingLabel || state.typingLabel;
          state.footerBranding = data.bot.footerBranding || null;
          state.proactiveMessage = data.bot.proactiveMessage || null;
          state.autoOpen = Boolean(data.bot.autoOpen);
          state.autoOpenOnce = data.bot.autoOpenOnce !== false;
          state.autoOpenDelaySeconds = Number(data.bot.autoOpenDelaySeconds || 3);
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
          if (els.launcher) els.launcher.innerHTML = launcherSvg(state.launcherIcon) + '<span class="' + P + 'launcher-label">' + escapeHtml(cfg.title) + '</span>';
          if (els.status) els.status.textContent = state.onlineLabel;
          if (els.brand) {
            els.brand.textContent = state.footerBranding || '';
            els.brand.style.display = state.footerBranding ? 'block' : 'none';
          }
          applyWidgetAppearance();
          scheduleAutoOpen();
        }
        state.quickActions = data.quickActions || [];
        renderQuickActions();
      })
      .catch(function () {
        state.configLoaded = true;
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

  var typingRow = null;
  function showTyping() {
    if (typingRow) return;
    typingRow = document.createElement('div');
    typingRow.className = P + 'row ' + P + 'them';
    typingRow.innerHTML =
      '<div><div class="' + P + 'typing-label">' + escapeHtml(state.typingLabel || 'Assistant is typing') + '</div><div class="' + P + 'typing"><span></span><span></span><span></span></div></div>';
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
    if (kind === 'spark') return '<svg viewBox="0 0 24 24"><path d="M12 2l2.4 6.4L21 11l-6.6 2.6L12 20l-2.4-6.4L3 11l6.6-2.6z"/></svg>';
    if (kind === 'help') return '<svg viewBox="0 0 24 24"><path d="M11 18h2v-2h-2v2zm1-16C6.5 2 2 6 2 11h2c0-3.9 3.6-7 8-7s8 3.1 8 7-3.6 7-8 7v2c5.5 0 10-4 10-9S17.5 2 12 2zm0 4c-2.2 0-4 1.3-4 3h2c0-.6.9-1 2-1s2 .7 2 1.5c0 1.5-3 1.4-3 4.5h2c0-2 3-2.2 3-4.5C16 7.6 14.2 6 12 6z"/></svg>';
    return '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';
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

  function isMobileViewport() {
    return window.matchMedia && window.matchMedia('(max-width: 480px)').matches;
  }

  function applyWidgetAppearance() {
    if (!els.root || !els.launcher || !els.win) return;
    var isMobile = isMobileViewport();
    var visible = isMobile ? state.showOnMobile : state.showOnDesktop;
    els.root.style.display = visible ? '' : 'none';

    var z = String(state.zIndex || 2147483000);
    els.launcher.style.zIndex = z;
    els.win.style.zIndex = z;

    var bottom = Number(state.bottomOffset || 20);
    var side = Number(state.sideOffset || 20);
    els.launcher.style.bottom = 'calc(' + bottom + 'px + env(safe-area-inset-bottom))';
    els.launcher.style.right = state.position === 'left' ? 'auto' : 'calc(' + side + 'px + env(safe-area-inset-right))';
    els.launcher.style.left = state.position === 'left' ? 'calc(' + side + 'px + env(safe-area-inset-left))' : 'auto';
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
      compact: { w: 328, h: 460 },
      default: { w: 360, h: 520 },
      large: { w: 420, h: 640 }
    };
    var ws = windowSizes[state.windowSize] || windowSizes.default;
    if (isMobile) {
      // Phones: hand the window box to the responsive CSS. Clear any desktop
      // inline px (they'd beat the media query); applyMobileViewport handles the
      // visual-viewport pinning so the input stays above the keyboard.
      els.win.classList.toggle(P + 'mobile-sheet', state.mobileMode === 'bottom_sheet');
      els.win.style.width = '';
      els.win.style.height = '';
      els.win.style.top = '';
      els.win.style.bottom = '';
      els.win.style.left = '';
      els.win.style.right = '';
      applyMobileViewport();
    } else {
      els.win.classList.remove(P + 'mobile-sheet');
      els.win.style.top = '';
      els.win.style.width = ws.w + 'px';
      els.win.style.height = ws.h + 'px';
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
    var h = vv ? vv.height : window.innerHeight;
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
    els.win.classList.add(P + 'show');
    if (!state.configLoaded) loadWidgetConfig('initial');
    if (!state.welcomed) {
      addBubble('them', auto && state.proactiveMessage ? state.proactiveMessage : cfg.welcome);
      state.welcomed = true;
    }
    // Only grab focus on a deliberate open — auto-open shouldn't pop the mobile
    // keyboard or steal focus from the page.
    if (!auto) els.input.focus();
    connectRealtime();
  }

  function closeWidget() {
    if (!state.open) return;
    state.open = false;
    els.win.classList.remove(P + 'show');
    disconnectRealtime();
  }

  function scheduleAutoOpen() {
    if (!state.autoOpen || state.autoOpenTimer || state.open) return;
    if (state.autoOpenOnce && lsGet('autoOpened') === '1') return;
    state.autoOpenTimer = setTimeout(function () {
      state.autoOpenTimer = null;
      if (state.autoOpenOnce) lsSet('autoOpened', '1');
      if (!state.open) openWidget(true);
    }, Math.max(0, Number(state.autoOpenDelaySeconds || 0)) * 1000);
  }

  // ---- Open/close & realtime ------------------------------------------------
  function toggle() {
    if (state.open) closeWidget();
    else openWidget(false);
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
      if (m.sender_type === 'system') addBubble('sys', m.content_text || '');
      else addBubble('them', m.content_text || '');
      if (m.created_at && (!state.lastTimestamp || m.created_at > state.lastTimestamp)) {
        state.lastTimestamp = m.created_at;
        lsSet('after', state.lastTimestamp);
      }
      return;
    }
    if (evt.type === 'conversation.updated') {
      if (evt.status === 'human_active') addBubble('sys', 'A human agent is now handling this chat.');
      if (evt.status === 'closed') addBubble('sys', 'This chat has been closed.');
    }
  }

  // ---- Send + SSE stream ----------------------------------------------------
  function setSending(on) {
    state.sending = on;
    els.send.disabled = on;
    els.input.disabled = on;
  }

  function onSend() {
    if (state.sending) return;
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
          throw new Error('bad_response_' + res.status);
        }
        return consumeStream(res.body.getReader());
      })
      .catch(function () {
        hideTyping();
        if (!state.currentBotBubble) {
          addBubble('them', 'Sorry, something went wrong. Please try again.');
        }
      })
      .then(function () {
        setSending(false);
        els.input.focus();
      });
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
        hideTyping();
        if (!state.currentBotBubble) {
          state.currentBotBubble = addBubble('them', '');
          state.currentBotBubble._raw = '';
        }
        state.currentBotBubble._raw += evt.value != null ? evt.value : '';
        state.currentBotBubble.innerHTML = renderMarkdown(state.currentBotBubble._raw);
        scrollDown();
        break;
      case 'action':
        // The bot asked the widget to render a UI element (form / quick replies
        // / product cards / fallback CTA) inline in the conversation.
        hideTyping();
        state.currentBotBubble = null;
        try { renderInlineAction(evt); } catch (e) {}
        break;
      case 'human':
        hideTyping();
        addBubble('sys', 'An agent will reply shortly.');
        connectRealtime();
        break;
      case 'error':
        hideTyping();
        addBubble('them', evt.value || 'Sorry, something went wrong.');
        state.currentBotBubble = null;
        break;
      case 'done':
        hideTyping();
        state.currentBotBubble = null;
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
  function init() {
    injectStyles();
    buildDom();
    els.form.addEventListener('submit', onActionFormSubmit);
    window.addEventListener('resize', applyWidgetAppearance);
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
