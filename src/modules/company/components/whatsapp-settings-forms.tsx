'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormState } from 'react-dom';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { CHECKBOX } from './form-layout';
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
          className={CHECKBOX}
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
    // `sm:grid-cols-[1fr_auto_auto]` sized two of the three tracks to their
    // CONTENT — and the content of track two is a field whose hint is a full
    // sentence ("With the country code and a leading +, exactly as it is saved
    // on their phone."). An `auto` track takes that sentence's max-content
    // width, so from 640px up the hint decided the layout: the phone box grew
    // to fit a line of help text and the channel select in `1fr` was squeezed
    // to whatever was left. `auto-fit` with a floor asks the CARD instead, and
    // every field gets at least a width it can be used at.
    <form
      ref={ref}
      action={action}
      className="grid items-end gap-4 [grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))]"
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
          {/* `rounded border-input` did nothing at all: the browser is still
              painting this control itself, so its own border and radius win.
              `CHECKBOX` is the shared class, and `accent-primary` is the one
              property that genuinely recolours a native box. */}
          <input type="checkbox" name="optedIn" value="true" defaultChecked className={CHECKBOX} />
          <span>They agreed to be messaged</span>
        </label>
        <SubmitButton size="sm" pendingLabel="Saving…">
          Add contact
        </SubmitButton>
      </div>
      {/* `sm:col-span-3` named a column count this grid no longer has — and an
          item asking to span three columns of a one-column `auto-fit` grid makes
          the browser invent the missing tracks, which is how a row overflows its
          card. `1 / -1` is "first line to last", correct at any column count. */}
      <div className="[grid-column:1/-1]">
        <FormMessage state={state} okText="Contact saved." />
      </div>
    </form>
  );
}
