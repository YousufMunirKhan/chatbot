'use client';

import { useFormState } from 'react-dom';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { RefreshDashboardShell } from '@/components/refresh-dashboard-shell';
import { updateProfileAction, type ActionState } from '../actions';
import type { CompanyProfile } from '../data';
import { COUNTRY_OPTIONS, TIMEZONE_OPTIONS } from '../form-options';

const initial: ActionState = {};

/**
 * Show an IANA timezone id as a place name.
 *
 * `Europe/London` is stored, submitted and compared verbatim — only the text
 * shown changes, to "London (Europe/London)". The id stays in the text because
 * an owner who was given a specific one has to be able to find it.
 *
 * Deliberately duplicated in `connect-integration-form.tsx`: the list both
 * format (`TIMEZONE_OPTIONS`) lives in a module this change does not own, so
 * there is nowhere shared to put it yet.
 */
function timezoneLabel(id: string): string {
  const place = id.split('/').pop()?.replace(/_/g, ' ') ?? id;
  return `${place} (${id})`;
}

export function ProfileForm({ company }: { company: CompanyProfile }) {
  const [state, action] = useFormState(updateProfileAction, initial);

  return (
    <form action={action} className="space-y-4">
      <RefreshDashboardShell state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Company name" htmlFor="name" required>
          <Input name="name" required defaultValue={company.name} />
        </FormField>
        <FormField label="Website" htmlFor="website">
          <Input name="website" type="url" defaultValue={company.website ?? ''} />
        </FormField>
        <FormField label="Country" htmlFor="country">
          <Select name="country" defaultValue={company.country ?? 'GB'}>
            {/* A country we have no name for still has to stay selectable, or
                saving anything else would silently change it. Saying it is a
                country code at least tells the owner what "AE" is; the value
                submitted is the code itself and is unchanged. */}
            {company.country &&
            !COUNTRY_OPTIONS.some((country) => country.value === company.country) ? (
              <option value={company.country}>Country code {company.country}</option>
            ) : null}
            {COUNTRY_OPTIONS.map((country) => (
              <option key={country.value} value={country.value}>
                {country.label}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField
          label="Timezone"
          htmlFor="timezone"
          hint="Opening hours, reply-time targets and the times on your reports are all read in this zone."
        >
          <Select name="timezone" defaultValue={company.timezone ?? 'Europe/London'}>
            {company.timezone && !TIMEZONE_OPTIONS.includes(company.timezone) ? (
              <option value={company.timezone}>{timezoneLabel(company.timezone)}</option>
            ) : null}
            {TIMEZONE_OPTIONS.map((timezone) => (
              <option key={timezone} value={timezone}>
                {timezoneLabel(timezone)}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Default language" htmlFor="defaultLanguage">
          <Select name="defaultLanguage" defaultValue={company.defaultLanguage}>
            <option value="auto">Auto-detect</option>
            <option value="en">English</option>
            <option value="ar">Arabic</option>
          </Select>
        </FormField>
      </div>
      <FormMessage state={state} okText="Profile saved." />
      <SubmitButton>Save profile</SubmitButton>
    </form>
  );
}
