'use client';

import { useEffect, useRef } from 'react';
import { useFormState } from 'react-dom';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { createWhatsAppTemplateAction, type ActionState } from '../whatsapp-actions';

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
    <form ref={ref} action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
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

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="submit"
          value="true"
          disabled={!canSubmitToMeta}
          className="h-4 w-4 rounded border-input"
        />
        <span className={canSubmitToMeta ? '' : 'text-muted-foreground'}>
          Submit to Meta for approval now
          {canSubmitToMeta ? null : ' (connect a number and set the WABA id first)'}
        </span>
      </label>

      <FormMessage state={state} okText="Template saved." />
      <SubmitButton pendingLabel="Saving…">Save template</SubmitButton>
    </form>
  );
}
