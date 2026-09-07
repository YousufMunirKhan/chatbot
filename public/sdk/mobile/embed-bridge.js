/*!
 * ChatBridge — the JavaScript half of the mobile embed kit.
 *
 * Loaded by /embed/<publicBotId>. It is the ONLY contract between the chat page
 * and the native app hosting it in a WebView, and it is deliberately tiny: a
 * one-way event pipe out to the host, plus one function the host can call in.
 *
 * ---------------------------------------------------------------------------
 * MESSAGES OUT (page -> native host)
 *
 * Every message is a JSON string with exactly this envelope:
 *
 *   {
 *     "source":  "chat-bridge",   // always; ignore anything else
 *     "version": 1,               // bump = breaking change
 *     "type":    "<event name>",
 *     "ts":      1717070000000,   // epoch ms, page clock
 *     "payload": { ... }          // per-type, see below
 *   }
 *
 *   type: "ready"
 *     payload: { botId: string, identity: "verified"|"anonymous"|"unsigned"|"invalid"|"unconfigured" }
 *     Fired once, after the chat UI is interactive. `identity` says whether the
 *     signed user id you passed was accepted.
 *
 *   type: "conversation_started"
 *     payload: { conversationId: string, botId: string }
 *     Fired once per conversation, when the server allocates its id (i.e. after
 *     the customer's first message). Persist this if you want to deep-link back.
 *
 *   type: "unread_count_changed"
 *     payload: { count: number }
 *     Messages that arrived while the chat screen was not visible. Reset to 0
 *     when the page becomes visible again. Use it for your tab badge.
 *
 *   type: "human_requested"
 *     payload: { conversationId: string|null }
 *     The conversation has been handed to a human agent. A good moment to make
 *     sure push notifications are enabled in your app.
 *
 *   type: "close_pressed"
 *     payload: {}
 *     The customer tapped the close control in the chat header. The page does
 *     NOT close itself — dismiss your own view controller / finish() the
 *     Activity when you receive this.
 *
 *   type: "error"
 *     payload: { code: string, message: string }
 *     Something the customer can see went wrong (bot not found, rate limited).
 *
 * Delivery, in order of preference:
 *   1. window.AndroidChatBridge.postMessage(json)               (Android @JavascriptInterface)
 *   2. window.webkit.messageHandlers.chatBridge.postMessage(json) (iOS WKScriptMessageHandler)
 *   3. window.parent.postMessage(json, '*')                     (iframe / browser testing)
 * Register the Android interface under the name `AndroidChatBridge` and the iOS
 * handler under the name `chatBridge` and nothing else is required.
 *
 * ---------------------------------------------------------------------------
 * MESSAGES IN (native host -> page)
 *
 *   ChatBridge.setUser({ userId, name, email, phone, locale, signature })
 *     Hand over (or change) the signed customer identity after the page has
 *     loaded — typically because the customer just signed in inside your app.
 *     `signature` MUST be computed on YOUR SERVER as
 *     HMAC-SHA256(botSigningSecret, userId), hex-encoded. Calling this reloads
 *     the chat with the new identity, because verification happens server-side.
 *     Passing null/omitting userId signs the customer out to anonymous.
 *
 *   ChatBridge.close()
 *     Ask the page to behave as if the close control was tapped.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS NOT
 *
 * There is no native SDK here. This file assumes nothing about your app, keeps
 * no state across launches, and cannot show a notification. See
 * docs/MOBILE_EMBED.md.
 */
(function () {
  'use strict';

  var VERSION = 1;
  var listeners = [];

  function envelope(type, payload) {
    return JSON.stringify({
      source: 'chat-bridge',
      version: VERSION,
      type: type,
      ts: Date.now(),
      payload: payload || {},
    });
  }

  function post(type, payload) {
    var message = envelope(type, payload);
    try {
      if (window.AndroidChatBridge && typeof window.AndroidChatBridge.postMessage === 'function') {
        window.AndroidChatBridge.postMessage(message);
        return true;
      }
      if (
        window.webkit &&
        window.webkit.messageHandlers &&
        window.webkit.messageHandlers.chatBridge &&
        typeof window.webkit.messageHandlers.chatBridge.postMessage === 'function'
      ) {
        window.webkit.messageHandlers.chatBridge.postMessage(message);
        return true;
      }
      if (window.parent && window.parent !== window) {
        // Only used for local testing in an iframe. A native host never hits this.
        window.parent.postMessage(message, '*');
        return true;
      }
    } catch (e) {
      /* A host that tore down its handler must not break the chat. */
    }
    return false;
  }

  function notify(event) {
    for (var i = 0; i < listeners.length; i += 1) {
      try {
        listeners[i](event);
      } catch (e) {
        /* one bad listener must not stop the others */
      }
    }
  }

  var ChatBridge = {
    version: VERSION,

    /** The identity the host last supplied, or null. Read-only for the page. */
    user: null,

    // --- page -> host -------------------------------------------------------
    ready: function (botId, identity) {
      return post('ready', { botId: botId, identity: identity });
    },
    onConversationStarted: function (conversationId, botId) {
      return post('conversation_started', { conversationId: conversationId, botId: botId });
    },
    onUnreadCountChanged: function (count) {
      return post('unread_count_changed', { count: Number(count) || 0 });
    },
    onHumanRequested: function (conversationId) {
      return post('human_requested', { conversationId: conversationId || null });
    },
    onClosePressed: function () {
      return post('close_pressed', {});
    },
    onError: function (code, message) {
      return post('error', { code: String(code || 'unknown'), message: String(message || '') });
    },

    // --- host -> page -------------------------------------------------------
    /**
     * Called by the native host. Stores the identity and asks the page to
     * re-open itself with it; the page decides how (a full reload), because the
     * signature can only be checked on the server.
     */
    setUser: function (user) {
      ChatBridge.user = user && typeof user === 'object' ? user : null;
      notify({ type: 'user', user: ChatBridge.user });
      return true;
    },

    /** Called by the native host to trigger the same path as the close button. */
    close: function () {
      notify({ type: 'close' });
      return ChatBridge.onClosePressed();
    },

    /**
     * Used by the chat page (not the host) to hear about setUser/close.
     * Returns an unsubscribe function.
     */
    subscribe: function (listener) {
      if (typeof listener !== 'function') return function () {};
      listeners.push(listener);
      return function () {
        listeners = listeners.filter(function (l) {
          return l !== listener;
        });
      };
    },
  };

  window.ChatBridge = ChatBridge;
})();
