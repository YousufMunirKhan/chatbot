export const NOTIFICATION_EVENTS = [
  { key: 'new_lead', label: 'New lead' },
  { key: 'new_appointment', label: 'Appointment request' },
  { key: 'new_order', label: 'New order' },
  { key: 'human_takeover', label: 'Human handoff request' },
  { key: 'missed_conversation', label: 'Missed conversation' },
] as const;

export const DELIVERY_CHANNELS = [
  { key: 'email', label: 'Email' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'slack', label: 'Slack' },
  { key: 'webhook', label: 'Webhook' },
] as const;
