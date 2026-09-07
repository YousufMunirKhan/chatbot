'use strict';

/**
 * Shared helpers for the app definition.
 *
 * The four triggers differ only in their event name and the fields they
 * advertise, so the REST hook plumbing — subscribe, unsubscribe, unwrap the
 * delivery, fetch sample records — is written once here and each trigger file
 * is just its own description.
 */

/**
 * The customer's own installation URL, without a trailing slash.
 *
 * This platform is deployed per customer (and white-labelled by agencies), so
 * there is no single hostname to hard-code. The connection asks for it, which
 * is also what makes one Zapier app work against staging and production.
 */
const baseUrl = (bundle) => String(bundle.authData.appUrl || '').trim().replace(/\/+$/, '');

/** Our success envelope is `{ data, meta? }`. Every read goes through this. */
const unwrap = (response) => {
  const body = response.data;
  if (body && Object.prototype.hasOwnProperty.call(body, 'data')) return body.data;
  return body;
};

/**
 * `performSubscribe` — hand the platform the URL Zapier is listening on.
 *
 * The whole response object is stored by Zapier as `bundle.subscribeData`, so
 * the id in it is what `performUnsubscribe` uses later.
 */
const subscribeHook = (event, triggerLabel) => async (z, bundle) => {
  const response = await z.request({
    url: `${baseUrl(bundle)}/api/v1/hooks`,
    method: 'POST',
    body: {
      event,
      target_url: bundle.targetUrl,
      // This is what an owner reads on Company → Webhooks, so it is the
      // trigger's own name rather than the event id: "Zapier — New Enquiry"
      // tells them which Zap to go and look at.
      label: `Zapier — ${triggerLabel || event}`,
      client: 'zapier',
    },
  });
  return unwrap(response);
};

/**
 * `performUnsubscribe` — turning a Zap off must actually stop the deliveries.
 *
 * A subscription nobody unsubscribed keeps being delivered to a URL Zapier has
 * stopped answering, which costs the customer's webhook budget until the
 * platform's failure counter disables it. Doing it properly here is the
 * difference between a clean stop and five wasted deliveries.
 */
const unsubscribeHook = () => async (z, bundle) => {
  const id = bundle.subscribeData && bundle.subscribeData.id;
  if (!id) return {};
  const response = await z.request({
    url: `${baseUrl(bundle)}/api/v1/hooks/${id}`,
    method: 'DELETE',
  });
  return unwrap(response) || {};
};

/**
 * `perform` — what a Zap receives when the hook fires.
 *
 * The delivered body is the platform's signed webhook envelope
 * (`{ event, created_at, company_id, title, body, data }`); `data` is the whole
 * record and carries the `id` Zapier deduplicates on, so that is what the Zap
 * sees. Returning the envelope instead would bury every field one level down
 * and make the record's own `id` invisible.
 */
const performHook = () => (z, bundle) => {
  const request = bundle.cleanedRequest || {};
  const record = request.data && typeof request.data === 'object' ? request.data : request;
  return [record];
};

/**
 * `performList` — real records for the "test your trigger" step.
 *
 * Zapier will not let anyone finish a Zap without seeing sample data, and a hook
 * that has not fired yet has none. These come from the same SQL that shapes a
 * live delivery, so the fields mapped here are the fields that arrive later.
 */
const listSamples = (event) => async (z, bundle) => {
  const response = await z.request({
    url: `${baseUrl(bundle)}/api/v1/hooks/samples`,
    params: { event, limit: 3 },
  });
  const records = unwrap(response);
  return Array.isArray(records) ? records : [];
};

/**
 * The conversation object, shared by both conversation triggers so the two
 * cannot describe the same record differently.
 */
const CONVERSATION_OUTPUT_FIELDS = [
  { key: 'id', label: 'Conversation ID' },
  { key: 'channel', label: 'Channel' },
  { key: 'status', label: 'Status' },
  { key: 'language', label: 'Language' },
  { key: 'visitor_id', label: 'Visitor ID' },
  { key: 'customer_id', label: 'Customer ID' },
  { key: 'assigned_agent_id', label: 'Assigned agent ID' },
  { key: 'ai_enabled', label: 'AI answering', type: 'boolean' },
  { key: 'unread_count', label: 'Unread messages', type: 'integer' },
  { key: 'started_at', label: 'Started at' },
  { key: 'last_message_at', label: 'Last message at' },
  { key: 'closed_at', label: 'Closed at' },
];

/** Assemble one REST hook trigger from its description. */
const restHookTrigger = ({ key, noun, label, description, event, outputFields, sample }) => ({
  key,
  noun,
  display: { label, description },
  operation: {
    type: 'hook',
    performSubscribe: subscribeHook(event, label),
    performUnsubscribe: unsubscribeHook(),
    perform: performHook(),
    performList: listSamples(event),
    outputFields,
    sample,
  },
});

module.exports = {
  baseUrl,
  unwrap,
  subscribeHook,
  unsubscribeHook,
  performHook,
  listSamples,
  restHookTrigger,
  CONVERSATION_OUTPUT_FIELDS,
};
