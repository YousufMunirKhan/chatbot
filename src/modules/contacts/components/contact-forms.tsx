'use client';

import * as React from 'react';
import { useFormState } from 'react-dom';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import {
  addContactAddressAction,
  addContactNoteAction,
  addContactTagAction,
  renameContactAction,
  setContactAttributeAction,
  type ActionState,
} from '../contacts-actions';

/**
 * The five things an agent can change on a contact page.
 *
 * All of them are `useFormState` (React 18) over a server action, which is this
 * project's convention. They live in one client module because they are the
 * same three lines of wiring five times, and one hydration boundary is cheaper
 * than five.
 *
 * Each form empties itself on success. Every one of these adds a NEW thing — a
 * note, a tag, a detail, an address — so leaving the last value sitting in the
 * box invites the reader to press the button again and add it twice.
 */

const initial: ActionState = {};

function useResettingForm(state: ActionState) {
  const ref = React.useRef<HTMLFormElement>(null);
  React.useEffect(() => {
    // `useFormState` hands back a new object per submission, so this runs once
    // per successful action rather than once per render.
    if (state.ok) ref.current?.reset();
  }, [state]);
  return ref;
}

export function ContactNoteForm({ contactId }: { contactId: string }) {
  const [state, action] = useFormState(addContactNoteAction, initial);
  const ref = useResettingForm(state);

  return (
    <form ref={ref} action={action} className="space-y-3">
      <input type="hidden" name="contactId" value={contactId} />
      <FormField
        label="Add a note"
        htmlFor="contact-note-body"
        hint="Only your team sees this. The customer never does."
      >
        <Textarea name="body" required placeholder="Asked us to call after 6pm." />
      </FormField>
      <FormMessage state={state} okText="Note added." />
      <SubmitButton size="sm" pendingLabel="Saving…">
        Save note
      </SubmitButton>
    </form>
  );
}

export function ContactRenameForm({
  contactId,
  displayName,
}: {
  contactId: string;
  displayName: string | null;
}) {
  const [state, action] = useFormState(renameContactAction, initial);

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="contactId" value={contactId} />
      <FormField
        label="Name"
        htmlFor="contact-name"
        hint="What you would call them, not what a form once captured."
      >
        <Input name="name" defaultValue={displayName ?? ''} className="w-64" />
      </FormField>
      <SubmitButton size="sm" variant="outline" pendingLabel="Saving…">
        Save
      </SubmitButton>
      <FormMessage state={state} okText="Name saved." className="basis-full" />
    </form>
  );
}

export function ContactAddressForm({ contactId }: { contactId: string }) {
  const [state, action] = useFormState(addContactAddressAction, initial);
  const ref = useResettingForm(state);

  return (
    <form ref={ref} action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="contactId" value={contactId} />
      <FormField label="Kind" htmlFor="contact-address-kind">
        <Select size="sm" name="kind" defaultValue="email" className="w-auto">
          <option value="email">Email</option>
          <option value="phone">Phone</option>
        </Select>
      </FormField>
      <FormField
        label="Address"
        htmlFor="contact-address-value"
        hint="If it already belongs to another record, the two are the same person and get merged."
      >
        <Input name="value" required placeholder="jane@example.com" className="w-64" />
      </FormField>
      <SubmitButton size="sm" variant="outline" pendingLabel="Adding…">
        Add
      </SubmitButton>
      <FormMessage state={state} okText="Added." className="basis-full" />
    </form>
  );
}

export function ContactAttributeForm({ contactId }: { contactId: string }) {
  const [state, action] = useFormState(setContactAttributeAction, initial);
  const ref = useResettingForm(state);

  return (
    <form ref={ref} action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="contactId" value={contactId} />
      <FormField label="Detail" htmlFor="contact-attribute-key">
        <Input name="key" required placeholder="Account number" className="w-48" />
      </FormField>
      <FormField label="Value" htmlFor="contact-attribute-value">
        <Input name="value" placeholder="AC-88120" className="w-48" />
      </FormField>
      <SubmitButton size="sm" variant="outline" pendingLabel="Saving…">
        Save detail
      </SubmitButton>
      <FormMessage state={state} okText="Saved." className="basis-full" />
    </form>
  );
}

export function ContactTagForm({ contactId }: { contactId: string }) {
  const [state, action] = useFormState(addContactTagAction, initial);
  const ref = useResettingForm(state);

  return (
    <form ref={ref} action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="contactId" value={contactId} />
      <FormField label="Add a tag" htmlFor="contact-tag">
        <Input name="tag" required placeholder="vip" className="w-40" />
      </FormField>
      <SubmitButton size="sm" variant="outline" pendingLabel="Adding…">
        Add tag
      </SubmitButton>
      <FormMessage state={state} okText="Tag added." className="basis-full" />
    </form>
  );
}
