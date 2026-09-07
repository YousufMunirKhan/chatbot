'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormState } from 'react-dom';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import {
  saveCatalogSettingsAction,
  saveWabaIdAction,
  upsertSubscriberAction,
  type ActionState,
} from '../whatsapp-actions';

const initial: ActionState = {};

/**
 * The three small `useFormState` forms on the WhatsApp pages. They live in one
 * client module because each is a handful of fields and they are always
 * rendered next to each other.
 */

export function WabaIdForm({ identityId, wabaId }: { identityId: string; wabaId: string | null }) {
  const [state, action] = useFormState(saveWabaIdAction, initial);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="identityId" value={identityId} />
      <FormField
        label="WhatsApp Business Account (WABA) id"
        htmlFor="wabaId"
        hint="WhatsApp Manager → Account tools → the numeric id above your phone numbers. Templates cannot be created without it."
      >
        <Input
          name="wabaId"
          defaultValue={wabaId ?? ''}
          maxLength={64}
          placeholder="102938475610293"
        />
      </FormField>
      <FormMessage state={state} okText="Saved." />
      <SubmitButton size="sm" pendingLabel="Saving…">
        Save WABA id
      </SubmitButton>
    </form>
  );
}

export function CatalogSettingsForm({
  catalogId,
  isActive,
}: {
  catalogId: string | null;
  isActive: boolean;
}) {
  const [state, action] = useFormState(saveCatalogSettingsAction, initial);
  return (
    <form action={action} className="space-y-3">
      <FormField
        label="Commerce catalog id"
        htmlFor="catalogId"
        hint="Commerce Manager → your catalog → Settings. The catalog must be linked to this WhatsApp Business Account."
      >
        <Input
          name="catalogId"
          defaultValue={catalogId ?? ''}
          maxLength={64}
          placeholder="1234567890123456"
        />
      </FormField>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isActive"
          value="true"
          defaultChecked={isActive}
          className="h-4 w-4 rounded border-input"
        />
        <span>Let the assistant send product cards</span>
      </label>
      <FormMessage state={state} okText="Catalog settings saved." />
      <SubmitButton size="sm" pendingLabel="Saving…">
        Save catalog
      </SubmitButton>
    </form>
  );
}

export function SubscriberForm() {
  const [state, action] = useFormState(upsertSubscriberAction, initial);
  // The one "Contact" box holds a phone number on two of the three channels and
  // an email address on the third, and it always said `+971500000000` and
  // "A phone number is required" (whatsapp-actions.ts:294). Someone adding an
  // email contact was shown a phone number as the example of a correct value.
  const [channel, setChannel] = useState<'whatsapp' | 'sms' | 'email'>('whatsapp');
  const isEmail = channel === 'email';
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);

  return (
    <form
      ref={ref}
      action={action}
      className="grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end"
    >
      {/* Channel comes first now: it decides what the box beside it wants. */}
      <FormField label="Reach them on" htmlFor="channel">
        <Select
          name="channel"
          value={channel}
          onChange={(e) => setChannel(e.target.value as typeof channel)}
        >
          <option value="whatsapp">WhatsApp</option>
          <option value="sms">SMS</option>
          <option value="email">Email</option>
        </Select>
      </FormField>
      <FormField
        label={isEmail ? 'Email address' : 'Phone number'}
        htmlFor="contact"
        required
        hint={
          isEmail
            ? 'The address they receive your messages at.'
            : 'With the country code and a leading +, exactly as it is saved on their phone.'
        }
      >
        <Input
          name="contact"
          required
          maxLength={64}
          type={isEmail ? 'email' : 'tel'}
          inputMode={isEmail ? 'email' : 'tel'}
          pattern={isEmail ? undefined : '\\+[0-9 ]{6,}'}
          placeholder={isEmail ? 'name@example.com' : '+971500000000'}
        />
      </FormField>
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="optedIn"
            value="true"
            defaultChecked
            className="h-4 w-4 rounded border-input"
          />
          <span>They agreed to be messaged</span>
        </label>
        <SubmitButton size="sm" pendingLabel="Saving…">
          Add contact
        </SubmitButton>
      </div>
      <div className="sm:col-span-3">
        <FormMessage state={state} okText="Contact saved." />
      </div>
    </form>
  );
}
