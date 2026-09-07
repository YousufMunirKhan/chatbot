/**
 * The rows of the "which events go to which channel" grid on /company/notifications.
 *
 * Every label is the thing that happened, said the way the owner would say it —
 * "Human handoff request" and "Missed conversation" were our words for our own
 * internal events.
 *
 * `missed_conversation` is the odd one out and is marked as such. It is a real
 * key — it is in the `NotifyEvent` union (src/lib/notify.ts:22) and in
 * `CORE_EVENTS` (src/lib/notification-delivery.ts:68) — but NOTHING IN THE
 * CODEBASE EVER EMITS IT. Every other event here has a dispatch site
 * (`new_lead` from src/lib/tools/leads.ts, `new_order` from
 * src/lib/tools/cart.ts, and so on); grep `missed_conversation` and you get the
 * type, the set, and this line. So its five toggles configure a delivery that
 * can never happen. The stored keys are untouched — a company that ticked
 * something keeps its row — but the label no longer lets an owner believe they
 * have switched on an alert for chats nobody answered.
 */
export const NOTIFICATION_EVENTS = [
  { key: 'new_lead', label: 'Someone left their details' },
  { key: 'new_appointment', label: 'Someone asked to book' },
  { key: 'new_order', label: 'An order came in' },
  { key: 'human_takeover', label: 'A customer asked for a person' },
  { key: 'missed_conversation', label: 'A chat nobody answered — not sent yet' },
  { key: 'helpdesk_issue_reported', label: 'A member of staff reported a problem' },
  { key: 'helpdesk_issue_resolved', label: 'A reported problem was fixed' },
] as const;

export const DELIVERY_CHANNELS = [
  { key: 'email', label: 'Email' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'slack', label: 'Slack' },
  { key: 'webhook', label: 'Webhook' },
  // Web push to the installed dashboard app. Delivered by src/lib/push, not by
  // notification-delivery.ts — it targets devices rather than addresses — but
  // it is configured here so admins have one grid, not two.
  { key: 'push', label: 'Phone alert' },
] as const;
