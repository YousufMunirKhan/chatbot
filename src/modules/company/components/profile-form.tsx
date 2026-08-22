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
            {company.country && !COUNTRY_OPTIONS.some((country) => country.value === company.country) ? (
              <option value={company.country}>{company.country}</option>
            ) : null}
            {COUNTRY_OPTIONS.map((country) => (
              <option key={country.value} value={country.value}>
                {country.label}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Timezone" htmlFor="timezone">
          <Select name="timezone" defaultValue={company.timezone ?? 'Europe/London'}>
            {company.timezone && !TIMEZONE_OPTIONS.includes(company.timezone) ? (
              <option value={company.timezone}>{company.timezone}</option>
            ) : null}
            {TIMEZONE_OPTIONS.map((timezone) => (
              <option key={timezone} value={timezone}>
                {timezone}
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
