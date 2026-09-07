/*!
 * AIAssistant JavaScript SDK — v1 public API client.
 *
 * Dependency-free UMD build: works with `require()`, an AMD loader, or a plain
 * <script> tag (which defines the global `AIAssistant`).
 *
 * SERVER SIDE ONLY. An API key grants full access to your account's data under
 * its scopes; shipping one in a browser bundle publishes it. Call the API from
 * your own backend and pass results to the browser.
 *
 * Usage:
 *   const assistant = new AIAssistant({ apiKey: process.env.ASSISTANT_API_KEY, baseUrl: 'https://app.example.com' });
 *   const { data, meta } = await assistant.conversations.list({ status: 'human_active' });
 *   await assistant.messages.send({ conversation_id: data[0].id, text: 'Hello' });
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else if (typeof define === 'function' && define.amd) define([], factory);
  else root.AIAssistant = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DEFAULT_TIMEOUT_MS = 15000;
  var DEFAULT_MAX_RETRIES = 2;
  /** 429 and 5xx are transient; everything else is the caller's problem. */
  var RETRY_STATUSES = [429, 500, 502, 503, 504];

  /**
   * An error returned by the API, or a transport failure.
   * @constructor
   * @param {string} message
   * @param {{code?: string, status?: number, body?: *}} [info]
   */
  function AIAssistantError(message, info) {
    var err = Error.call(this, message);
    this.name = 'AIAssistantError';
    this.message = message;
    this.stack = err.stack;
    info = info || {};
    /** @type {string} Machine-readable code, e.g. "rate_limited". */
    this.code = info.code || 'request_failed';
    /** @type {number} HTTP status, or 0 when the request never completed. */
    this.status = info.status || 0;
    /** @type {*} Parsed response body, when there was one. */
    this.body = info.body;
  }
  AIAssistantError.prototype = Object.create(Error.prototype);
  AIAssistantError.prototype.constructor = AIAssistantError;

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  /** Drop undefined/null so `?status=undefined` never reaches the server. */
  function queryString(params) {
    if (!params) return '';
    var parts = [];
    for (var key in params) {
      if (!Object.prototype.hasOwnProperty.call(params, key)) continue;
      var value = params[key];
      if (value === undefined || value === null || value === '') continue;
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
    }
    return parts.length ? '?' + parts.join('&') : '';
  }

  /**
   * @constructor
   * @param {{apiKey: string, baseUrl?: string, timeoutMs?: number, maxRetries?: number, fetch?: Function}} options
   */
  function AIAssistant(options) {
    if (!(this instanceof AIAssistant)) return new AIAssistant(options);
    options = options || {};
    if (!options.apiKey) throw new AIAssistantError('An `apiKey` is required.', { code: 'invalid_request' });

    this.apiKey = options.apiKey;
    this.baseUrl = String(options.baseUrl || 'https://app.assistant.ai').replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries == null ? DEFAULT_MAX_RETRIES : options.maxRetries;
    this._fetch = options.fetch || (typeof fetch === 'function' ? fetch.bind(null) : null);
    if (!this._fetch) {
      throw new AIAssistantError('No global fetch found — pass `fetch` in the options (Node < 18).', {
        code: 'not_configured',
      });
    }

    var self = this;

    /** Conversations held with your customers. */
    this.conversations = {
      /** @param {{page?:number, per_page?:number, status?:string, channel?:string, since?:string}} [params] */
      list: function (params) {
        return self.request('GET', '/api/v1/conversations', { query: params });
      },
      /** @param {string} id @returns {Promise<{data: Object}>} conversation + `messages` */
      get: function (id) {
        return self.request('GET', '/api/v1/conversations/' + encodeURIComponent(id));
      },
    };

    /** Outbound messages. */
    this.messages = {
      /** @param {{text:string, conversation_id?:string, channel?:string, to?:string}} body */
      send: function (body) {
        return self.request('POST', '/api/v1/messages', { body: body });
      },
    };

    /** Contacts (leads captured by the assistant or created through the API). */
    this.contacts = {
      /** @param {{page?:number, per_page?:number, status?:string, source?:string, since?:string, q?:string}} [params] */
      list: function (params) {
        return self.request('GET', '/api/v1/contacts', { query: params });
      },
      /** @param {{name?:string, email?:string, phone?:string, enquiry_type?:string, message?:string, status?:string}} body */
      create: function (body) {
        return self.request('POST', '/api/v1/contacts', { body: body });
      },
      /** @param {string} id */
      get: function (id) {
        return self.request('GET', '/api/v1/contacts/' + encodeURIComponent(id));
      },
    };

    /** Orders placed in chat, or synced from a connected store. */
    this.orders = {
      /** @param {{page?:number, per_page?:number, source?:'chat'|'synced', status?:string, since?:string}} [params] */
      list: function (params) {
        return self.request('GET', '/api/v1/orders', { query: params });
      },
    };

    /** The catalogue the assistant quotes from. */
    this.products = {
      /** @param {{page?:number, per_page?:number, category?:string, status?:string, q?:string}} [params] */
      list: function (params) {
        return self.request('GET', '/api/v1/products', { query: params });
      },
    };

    /** Scheduled messages to your contact list. */
    this.broadcasts = {
      /** @param {{channel:'whatsapp'|'email', message:string, subject?:string, schedule_at?:string}} body */
      create: function (body) {
        return self.request('POST', '/api/v1/broadcasts', { body: body });
      },
    };

    /** Aggregate counts for a date range. */
    this.analytics = {
      /** @param {{from?:string, to?:string}} [params] */
      summary: function (params) {
        return self.request('GET', '/api/v1/analytics/summary', { query: params });
      },
    };
  }

  /** One HTTP attempt, with a timeout that does not leak a pending timer. */
  AIAssistant.prototype._attempt = function (method, url, body) {
    var self = this;
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = controller
      ? setTimeout(function () {
          controller.abort();
        }, this.timeoutMs)
      : null;

    var headers = {
      Authorization: 'Bearer ' + this.apiKey,
      Accept: 'application/json',
      'User-Agent': 'assistant-sdk-js/1.0',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    var init = { method: method, headers: headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    if (controller) init.signal = controller.signal;

    return self._fetch(url, init).then(
      function (response) {
        if (timer) clearTimeout(timer);
        return response;
      },
      function (err) {
        if (timer) clearTimeout(timer);
        throw err;
      },
    );
  };

  /**
   * Perform a request, retrying transient failures with exponential backoff.
   * A `Retry-After` header is honoured over the computed backoff.
   *
   * @param {string} method
   * @param {string} path
   * @param {{query?: Object, body?: Object}} [options]
   * @returns {Promise<Object>} The parsed `{ data, meta? }` envelope.
   */
  AIAssistant.prototype.request = function (method, path, options) {
    options = options || {};
    var self = this;
    var url = this.baseUrl + path + queryString(options.query);
    var attempt = 0;

    function run() {
      return self._attempt(method, url, options.body).then(
        function (response) {
          return response.text().then(function (text) {
            var parsed = null;
            if (text) {
              try {
                parsed = JSON.parse(text);
              } catch (e) {
                parsed = null;
              }
            }

            if (response.ok) {
              if (parsed === null) {
                throw new AIAssistantError('The server returned a non-JSON response.', {
                  code: 'invalid_response',
                  status: response.status,
                });
              }
              return parsed;
            }

            var retryable = RETRY_STATUSES.indexOf(response.status) !== -1;
            if (retryable && attempt < self.maxRetries) {
              attempt++;
              var header = Number(response.headers && response.headers.get('retry-after'));
              var wait = header > 0 ? header * 1000 : Math.pow(2, attempt) * 250;
              return sleep(wait).then(run);
            }

            var envelope = (parsed && parsed.error) || {};
            throw new AIAssistantError(
              envelope.message || 'Request failed with status ' + response.status,
              { code: envelope.code || 'request_failed', status: response.status, body: parsed },
            );
          });
        },
        function (err) {
          // Network failure or timeout: retry, then surface as a AIAssistantError.
          if (attempt < self.maxRetries) {
            attempt++;
            return sleep(Math.pow(2, attempt) * 250).then(run);
          }
          throw new AIAssistantError(err && err.message ? err.message : 'Network request failed.', {
            code: 'network_error',
          });
        },
      );
    }

    return run();
  };

  AIAssistant.AIAssistantError = AIAssistantError;
  AIAssistant.VERSION = '1.0.0';
  return AIAssistant;
});
