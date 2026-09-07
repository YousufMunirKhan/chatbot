/**
 * The events a company can have pushed to another system, and their plain names.
 *
 * There used to be two lists: `EVENTS` inside `webhook-form.tsx` ("New lead")
 * and `EVENT_LABELS` inside the webhooks page ("Someone left their details").
 * The same stored event therefore had one name on the tick-box that switched it
 * on and a different one in the table that reported it.
 *
 * This module is the one definition. It lives in `src/lib/` rather than in the
 * form because the form is a `'use client'` module, and a server component
 * importing a plain object out of one fails at runtime with "Could not find the
 * module … in the React Client Manifest" — a page that renders blank with
 * nothing wrong at compile time. Plain constants, no `'use client'`, so both the
 * client form and the server page can import it.
 *
 * The owner-facing wording is kept over the terser one: `lead.created` is what
 * the receiving system needs and stays in the payload and the docs, but it is
 * not what belongs in a checkbox or a table cell an owner reads.
 */
export const WEBHOOK_EVENTS = [
  { value: 'lead.created', label: 'Someone left their details' },
  { value: 'appointment.created', label: 'Someone asked to book' },
  { value: 'order.created', label: 'Someone placed an order' },
  { value: 'ticket.created', label: 'A question needs a person' },
  { value: 'ticket.resolved', label: 'A question was sorted' },
] as const;

/** Lookup form of {@link WEBHOOK_EVENTS}, for rendering a stored event id. */
export const WEBHOOK_EVENT_LABELS: Record<string, string> = Object.fromEntries(
  WEBHOOK_EVENTS.map((event) => [event.value, event.label]),
);
