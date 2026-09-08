'use client';

import { useFormState } from 'react-dom';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { FIELD_GRID } from './form-layout';
import { RefreshDashboardShell } from '@/components/refresh-dashboard-shell';
import { updateProfileAction, type ActionState } from '../actions';
import type { CompanyProfile } from '../data';
import { COUNTRY_OPTIONS, TIMEZONE_OPTIONS } from '../form-options';
import { timezoneLabel } from '@/lib/constants';

const initial: ActionState = {};

export function ProfileForm({ company }: { company: CompanyProfile }) {
  const [state, action] = useFormState(updateProfileAction, initial);

  return (
    <form action={action} className="space-y-4">
      <RefreshDashboardShell state={state} />
      <div className={FIELD_GRID}>
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
        {/*
          Was "Default language", the identical label the assistant's own reply
          language carries on /company/bots/[id]/settings — two different stored
          columns (`companies.default_language` here, `bots.language_default`
          there) with the same three options and the same words, and neither
          screen said which was which.

          "Auto-detect" was also untrue: `normalizeLocale`
          (src/lib/i18n/index.ts:38) maps anything that is not `ar` to `en`, so
          picking it gives you English. The stored value is unchanged — existing
          rows hold `auto` — but the option now says what selecting it does.
        */}
        <FormField
          label="Dashboard language"
          htmlFor="defaultLanguage"
          hint="The language this dashboard is shown in, for everyone on your team who signs in. Arabic also flips the whole layout right-to-left. What language your assistant answers customers in is set separately, on the assistant itself."
        >
          <Select name="defaultLanguage" defaultValue={company.defaultLanguage}>
            <option value="auto">English (the default)</option>
            <option value="en">English</option>
            <option value="ar">Arabic — right-to-left</option>
          </Select>
        </FormField>
      </div>
      <FormMessage state={state} okText="Profile saved." />
      <SubmitButton>Save profile</SubmitButton>
    </form>
  );
}
