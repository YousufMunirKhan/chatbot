'use client';

import { useEffect, useRef } from 'react';
import { useFormState } from 'react-dom';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { cn } from '@/lib/utils';
import { createWhatsAppTemplateAction, type ActionState } from '../whatsapp-actions';
import { CHECKBOX, CHOICE_CARD, FIELD_GRID, FORM_SECTION, FORM_SECTION_TITLE } from './form-layout';

const initial: ActionState = {};

/** Languages Meta lists most often for this product's customer base. */
const LANGUAGES: Array<[string, string]> = [
  ['en_US', 'English (US)'],
  ['en_GB', 'English (UK)'],
  ['ar', 'Arabic'],
  ['ar_EG', 'Arabic (Egypt)'],
  ['fr', 'French'],
  ['es', 'Spanish'],
  ['hi', 'Hindi'],
  ['ur', 'Urdu'],
  ['tr', 'Turkish'],
];

export function WhatsAppTemplateForm({ canSubmitToMeta }: { canSubmitToMeta: boolean }) {
  const [state, action] = useFormState(createWhatsAppTemplateAction, initial);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);

  return (
    <form ref={ref} action={action} className="space-y-6">
      {/* Seven fields with nothing grouping them, in the order the database
          stores them. They are two different jobs: how Meta files the template,
          and what the customer actually reads. Split, and titled. */}
      <section className={FORM_SECTION}>
        <h3 className={FORM_SECTION_TITLE}>How WhatsApp files it</h3>
        {/* `sm:grid-cols-3` put three fields in ~190px each from 640px upward,
            which is where the "Lowercase and underscores" hint wrapped to three
            lines under a box narrower than the word "order_confirmation".
            `FIELD_GRID` measures the card instead. */}
        <div className={FIELD_GRID}>
          <FormField
            label="Template name"
            htmlFor="name"
            required
            hint="Lowercase and underscores — anything else is normalised."
          >
            <Input name="name" required maxLength={120} placeholder="order_confirmation" />
          </FormField>

          <FormField label="Language" htmlFor="language">
            <Select name="language" defaultValue="en_US">
              {LANGUAGES.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField
            label="Category"
            htmlFor="category"
            hint="Meta rejects promotions filed as Utility."
          >
            <Select name="category" defaultValue="MARKETING">
              <option value="MARKETING">Marketing</option>
              <option value="UTILITY">Utility</option>
              <option value="AUTHENTICATION">Authentication</option>
            </Select>
          </FormField>
        </div>
      </section>

      <section className={FORM_SECTION}>
        <h3 className={FORM_SECTION_TITLE}>What the customer reads</h3>

        <FormField label="Header text (optional)" htmlFor="headerText">
          <Input name="headerText" maxLength={60} placeholder="Your order is on its way" />
        </FormField>

        <FormField
          label="Body"
          htmlFor="body"
          required
          hint="Use {{1}}, {{2}} for values filled in at send time."
        >
          <Textarea
            name="body"
            required
            rows={4}
            maxLength={1024}
            placeholder="Hi {{1}}, your order {{2}} has shipped and arrives on {{3}}."
          />
        </FormField>

        <FormField label="Footer (optional)" htmlFor="footerText">
          <Input name="footerText" maxLength={60} placeholder="Reply STOP to unsubscribe" />
        </FormField>

        <FormField
          label="Buttons (optional)"
          htmlFor="buttons"
          hint="One per line. Add | and a URL for a link button, or | and a phone number to call."
        >
          <Textarea
            name="buttons"
            rows={3}
            placeholder={'Track order|https://example.com/track\nTalk to us'}
          />
        </FormField>
      </section>

      {/* The one decision on this form that leaves the building — it hands your
          wording to Meta for review — was a bare tick box between a textarea and
          the Save button. It is now a described choice, and when it cannot be
          used it says what to go and do instead of trailing off in a
          parenthesis. */}
      <label className={cn(CHOICE_CARD, !canSubmitToMeta && 'bg-muted/40')}>
        <input
          type="checkbox"
          name="submit"
          value="true"
          disabled={!canSubmitToMeta}
          className={CHECKBOX}
        />
        <span>
          <span className="block font-medium">Send it for approval now</span>
          <span className="block text-xs text-muted-foreground">
            {canSubmitToMeta
              ? 'Meta usually answers within a few minutes. You can also save it as a draft and send it for approval later.'
              : 'Not available yet — connect a WhatsApp number and set its WABA id first. Saving still keeps your draft.'}
          </span>
        </span>
      </label>

      <FormMessage state={state} okText="Template saved." />
      <SubmitButton pendingLabel="Saving…">Save template</SubmitButton>
    </form>
  );
}
