'use client';

import { useEffect, useRef } from 'react';
import { useFormState } from 'react-dom';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import type { AgencyBranding } from '@/lib/agency';
import {
  createAgencyAction,
  updateAgencyAction,
  type ActionState,
} from '../agencies-actions';

const initial: ActionState = {};

export interface AgencyFormProps {
  /** Omit to render the "create" form; pass an agency to render its editor. */
  agency?: {
    id: string;
    name: string;
    ownerEmail: string | null;
    customDomain: string | null;
    branding: AgencyBranding;
  };
}

/**
 * Create / edit an agency and its branding.
 *
 * One component for both modes because the fields are identical apart from the
 * hidden id — two nearly-identical forms is how the branding blob's fields drift
 * out of sync between the create and edit paths.
 */
export function AgencyForm({ agency }: AgencyFormProps) {
  const [state, action] = useFormState(agency ? updateAgencyAction : createAgencyAction, initial);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && !agency) ref.current?.reset();
  }, [state.ok, agency]);

  const b = agency?.branding;
  const id = (field: string) => (agency ? `${agency.id}-${field}` : `new-${field}`);

  return (
    <form ref={ref} action={action} className="space-y-4">
      {agency ? <input type="hidden" name="agencyId" value={agency.id} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Agency name" htmlFor={id('name')} required>
          <Input id={id('name')} name="name" required maxLength={120} defaultValue={agency?.name} />
        </FormField>
        {agency ? null : (
          <FormField label="Slug" htmlFor={id('slug')} hint="Left blank, it is built from the name.">
            <Input id={id('slug')} name="slug" maxLength={50} placeholder="acme-digital" />
          </FormField>
        )}
        <FormField
          label="Owner email"
          htmlFor={id('ownerEmail')}
          hint="An existing platform user. They get the /company/agency screen."
        >
          <Input
            id={id('ownerEmail')}
            name="ownerEmail"
            type="email"
            maxLength={200}
            defaultValue={agency?.ownerEmail ?? ''}
          />
        </FormField>
        <FormField
          label="Custom domain"
          htmlFor={id('customDomain')}
          hint="Host only, no scheme — app.acme.com."
        >
          <Input
            id={id('customDomain')}
            name="customDomain"
            maxLength={200}
            defaultValue={agency?.customDomain ?? ''}
          />
        </FormField>
      </div>

      <fieldset className="grid gap-4 rounded-md border p-4 sm:grid-cols-2">
        <legend className="px-1 text-sm font-medium">Branding</legend>
        <FormField label="Product name" htmlFor={id('productName')}>
          <Input
            id={id('productName')}
            name="productName"
            maxLength={80}
            defaultValue={b?.productName ?? ''}
            placeholder="Switch & Save"
          />
        </FormField>
        <FormField label="Primary colour" htmlFor={id('primaryColor')} hint="Hex, e.g. #2563eb.">
          <Input
            id={id('primaryColor')}
            name="primaryColor"
            maxLength={7}
            defaultValue={b?.primaryColor ?? ''}
            placeholder="#2563eb"
          />
        </FormField>
        <FormField label="Logo URL" htmlFor={id('logoUrl')}>
          <Input id={id('logoUrl')} name="logoUrl" maxLength={500} defaultValue={b?.logoUrl ?? ''} />
        </FormField>
        <FormField label="Login background URL" htmlFor={id('loginBackground')}>
          <Input
            id={id('loginBackground')}
            name="loginBackground"
            maxLength={500}
            defaultValue={b?.loginBackground ?? ''}
          />
        </FormField>
        <FormField label="Support email" htmlFor={id('supportEmail')}>
          <Input
            id={id('supportEmail')}
            name="supportEmail"
            type="email"
            maxLength={200}
            defaultValue={b?.supportEmail ?? ''}
          />
        </FormField>
        <label className="flex items-center gap-2 self-end text-sm">
          <input
            type="checkbox"
            name="hidePoweredBy"
            defaultChecked={b?.hidePoweredBy ?? false}
            className="h-4 w-4 rounded border-input"
          />
          Hide &ldquo;Powered by&rdquo;
        </label>
      </fieldset>

      <FormMessage state={state} okText={agency ? 'Agency updated.' : 'Agency created.'} />
      <SubmitButton pendingLabel={agency ? 'Saving…' : 'Creating…'}>
        {agency ? 'Save agency' : 'Create agency'}
      </SubmitButton>
    </form>
  );
}
