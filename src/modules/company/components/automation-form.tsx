'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormState } from 'react-dom';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import {
  AUTOMATION_EVENTS,
  EVENT_LABELS,
  TEMPLATE_PLACEHOLDERS,
  type AutomationEvent,
} from '@/lib/commerce/automation-templates';
import { saveAutomationRuleAction, type ActionState } from '../automations-actions';

const initial: ActionState = {};

export interface AutomationFormValues {
  id: string;
  name: string;
  triggerEvent: AutomationEvent;
  channel: string;
  templateName: string | null;
  messageTemplate: string;
  delayMinutes: number;
  conditions: Record<string, unknown>;
  isActive: boolean;
}

/**
 * Create / edit one automation rule.
 *
 * The placeholder list is rendered as clickable chips rather than prose: the
 * failure mode for a template field is a company typing `{{orderNumber}}` and
 * silently sending an empty line to a customer, so the only tokens that exist
 * are the ones the form can insert.
 */
export function AutomationForm({ rule }: { rule?: AutomationFormValues }) {
  const [state, action] = useFormState(saveAutomationRuleAction, initial);
  const [event, setEvent] = useState<AutomationEvent>(rule?.triggerEvent ?? 'order_paid');
  const [channel, setChannel] = useState(rule?.channel ?? 'whatsapp');
  // `customer_created` is the one event whose entity carries no money — its
  // `AutomationEntity.total` is never set, so `evaluateConditions`
  // (src/lib/commerce/automation-templates.ts:212) compares a minimum against 0
  // and the rule never fires again. Offering the field there was a trap.
  const supportsOrderTotal = event !== 'customer_created';
  const formRef = useRef<HTMLFormElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (state.ok && !rule) formRef.current?.reset();
  }, [state.ok, rule]);

  const insert = (token: string) => {
    const el = messageRef.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    el.value = `${el.value.slice(0, start)}{{${token}}}${el.value.slice(end)}`;
    const caret = start + token.length + 4;
    el.focus();
    el.setSelectionRange(caret, caret);
  };

  const conditions = rule?.conditions ?? {};
  const abandonAfter = conditions.abandonAfterMinutes as number | undefined;
  const minTotal = conditions.minTotal as number | undefined;

  return (
    <form ref={formRef} action={action} className="space-y-4">
      {rule ? <input type="hidden" name="id" value={rule.id} /> : null}

      <FormField
        label="Name"
        htmlFor="name"
        required
        hint="Only you see this — it is how you will find this rule in the list."
      >
        <Input
          name="name"
          defaultValue={rule?.name}
          required
          maxLength={120}
          placeholder="Order confirmation"
        />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="When this happens" htmlFor="triggerEvent">
          <Select
            name="triggerEvent"
            value={event}
            onChange={(e) => setEvent(e.target.value as AutomationEvent)}
          >
            {AUTOMATION_EVENTS.map((key) => (
              <option key={key} value={key}>
                {EVENT_LABELS[key]}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField
          label="Send it on"
          htmlFor="channel"
          hint="Reaches the phone number or email address that came through with the order."
        >
          <Select
            name="channel"
            value={channel}
            onChange={(e) => setChannel(e.target.value as typeof channel)}
          >
            <option value="whatsapp">WhatsApp</option>
            <option value="email">Email</option>
          </Select>
        </FormField>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Wait before sending (minutes)"
          htmlFor="delayMinutes"
          hint="0 sends on the next dispatcher run, usually within a few minutes."
        >
          <Input
            name="delayMinutes"
            type="number"
            min={0}
            max={20160}
            defaultValue={rule?.delayMinutes ?? 0}
          />
        </FormField>

        {event === 'cart_abandoned' ? (
          <FormField
            label="Count a cart abandoned after (minutes)"
            htmlFor="abandonAfterMinutes"
            hint="Quiet time before the cart is chased. Defaults to 60."
          >
            <Input
              name="abandonAfterMinutes"
              type="number"
              min={1}
              max={20160}
              defaultValue={abandonAfter ?? 60}
            />
          </FormField>
        ) : supportsOrderTotal ? (
          <FormField
            label="Only above this order total"
            htmlFor="minTotal"
            hint="Optional. Leave empty to send for every order, whatever it was worth."
          >
            <Input
              name="minTotal"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              placeholder="Any amount"
              defaultValue={minTotal ?? ''}
            />
          </FormField>
        ) : null}
      </div>

      {/*
        `template_name` is only ever read as the email subject line
        (src/lib/commerce/automations.ts:289). On WhatsApp nothing reads it at
        all, so on that channel this box did nothing — and its label, "Subject /
        template name", read as if it might be the name of an approved WhatsApp
        template, which is a completely different thing. It is now an email-only
        field that says so, with a hidden input keeping anything already saved.
      */}
      {channel === 'email' ? (
        <FormField
          label="Email subject line"
          htmlFor="templateName"
          hint="What the customer sees in their inbox before opening it. The same {{placeholders}} work here as in the message."
        >
          <Input
            name="templateName"
            defaultValue={rule?.templateName ?? ''}
            maxLength={200}
            placeholder="Your order {{order_number}} is confirmed"
          />
        </FormField>
      ) : (
        <input type="hidden" name="templateName" value={rule?.templateName ?? ''} />
      )}

      <FormField label="Message" htmlFor="messageTemplate" required>
        <Textarea
          ref={messageRef}
          name="messageTemplate"
          required
          rows={6}
          maxLength={4000}
          defaultValue={rule?.messageTemplate}
          placeholder="Hi {{customer_name}}, thanks for order {{order_number}}."
        />
      </FormField>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Insert:</span>
        {TEMPLATE_PLACEHOLDERS.map((token) => (
          <button
            key={token}
            type="button"
            onClick={() => insert(token)}
            className="rounded border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          >
            {`{{${token}}}`}
          </button>
        ))}
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isActive"
          defaultChecked={rule ? rule.isActive : true}
          className="h-4 w-4 rounded border-input"
        />
        Send this message to customers from now on
      </label>

      <FormMessage state={state} okText={rule ? 'Automation updated.' : 'Automation created.'} />
      <SubmitButton>{rule ? 'Save changes' : 'Create automation'}</SubmitButton>
    </form>
  );
}
