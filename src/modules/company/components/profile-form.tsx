'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { updateProfileAction, type ActionState } from '../actions';
import type { CompanyProfile } from '../data';
import { COUNTRY_OPTIONS, TIMEZONE_OPTIONS } from '../form-options';

const initial: ActionState = {};
const selectCls =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function Save() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : 'Save profile'}
    </Button>
  );
}

export function ProfileForm({ company }: { company: CompanyProfile }) {
  const [state, action] = useFormState(updateProfileAction, initial);

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="name">Company name *</Label>
          <Input id="name" name="name" required defaultValue={company.name} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="website">Website</Label>
          <Input id="website" name="website" type="url" defaultValue={company.website ?? ''} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="country">Country</Label>
          <select id="country" name="country" className={selectCls} defaultValue={company.country ?? 'GB'}>
            {company.country && !COUNTRY_OPTIONS.some((country) => country.value === company.country) ? (
              <option value={company.country}>{company.country}</option>
            ) : null}
            {COUNTRY_OPTIONS.map((country) => (
              <option key={country.value} value={country.value}>
                {country.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="timezone">Timezone</Label>
          <select id="timezone" name="timezone" className={selectCls} defaultValue={company.timezone ?? 'Europe/London'}>
            {company.timezone && !TIMEZONE_OPTIONS.includes(company.timezone) ? (
              <option value={company.timezone}>{company.timezone}</option>
            ) : null}
            {TIMEZONE_OPTIONS.map((timezone) => (
              <option key={timezone} value={timezone}>
                {timezone}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="defaultLanguage">Default language</Label>
          <select
            id="defaultLanguage"
            name="defaultLanguage"
            className={selectCls}
            defaultValue={company.defaultLanguage}
          >
            <option value="auto">Auto-detect</option>
            <option value="en">English</option>
            <option value="ar">Arabic</option>
          </select>
        </div>
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-emerald-600">Profile saved.</p> : null}
      <Save />
    </form>
  );
}
