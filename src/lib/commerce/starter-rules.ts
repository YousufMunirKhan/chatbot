import type { AutomationEvent } from './automation-templates';

/**
 * One-click starter automations.
 *
 * These are the four messages every store sends. Shipping them as pre-filled
 * rules (rather than an empty form and a placeholder cheat-sheet) is the
 * difference between a company having automations on day one and having an
 * empty screen they never come back to.
 */
export interface StarterRule {
  key: string;
  name: string;
  description: string;
  triggerEvent: AutomationEvent;
  channel: 'whatsapp' | 'email';
  templateName: string;
  delayMinutes: number;
  messageTemplate: string;
  conditions: Record<string, unknown>;
}

export const STARTER_RULES: StarterRule[] = [
  {
    key: 'order_confirmation',
    name: 'Order confirmation',
    description: 'Thanks the customer the moment an order is paid.',
    triggerEvent: 'order_paid',
    channel: 'whatsapp',
    templateName: 'Your order {{order_number}} is confirmed',
    delayMinutes: 0,
    messageTemplate:
      'Hi {{customer_name}}, thanks for your order {{order_number}}!\n\nWe have received your payment of {{total}} and are getting it ready.\n\nItems: {{items}}',
    conditions: {},
  },
  {
    key: 'shipping_update',
    name: 'Shipping update',
    description: 'Sends the tracking link as soon as the order ships.',
    triggerEvent: 'order_shipped',
    channel: 'whatsapp',
    templateName: 'Order {{order_number}} is on its way',
    delayMinutes: 0,
    messageTemplate:
      'Good news {{customer_name}} — order {{order_number}} has shipped.\n\nTrack it here: {{tracking_url}}',
    conditions: {},
  },
  {
    key: 'cancellation_notice',
    name: 'Cancellation notice',
    description: 'Confirms a cancellation and points the customer at support.',
    triggerEvent: 'order_cancelled',
    channel: 'email',
    templateName: 'Order {{order_number}} has been cancelled',
    delayMinutes: 0,
    messageTemplate:
      'Hi {{customer_name}}, your order {{order_number}} ({{total}}) has been cancelled.\n\nIf a refund is due it will be back with you within a few working days. Reply to this message if anything looks wrong.',
    conditions: {},
  },
  {
    key: 'abandoned_cart',
    name: 'Abandoned cart recovery',
    description: 'Nudges shoppers an hour after they leave a full cart.',
    triggerEvent: 'cart_abandoned',
    channel: 'whatsapp',
    templateName: 'You left something behind',
    delayMinutes: 60,
    messageTemplate:
      'Hi {{customer_name}}, you left {{items}} in your cart.\n\nFinish your order here: {{recovery_url}}',
    conditions: { abandonAfterMinutes: 60 },
  },
];

export function getStarterRule(key: string): StarterRule | null {
  return STARTER_RULES.find((r) => r.key === key) ?? null;
}
