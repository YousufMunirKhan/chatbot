'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  addFaqAction,
  addLocationAction,
  addPolicyAction,
  addServiceAction,
  updateFaqAction,
  updateBusinessMemoryAction,
  updateHoursAction,
  updatePolicyAction,
  updateServiceAction,
  type ActionState,
} from '../business-profile-actions';
import {
  FAQ_CATEGORY_OPTIONS,
  POLICY_CATEGORY_OPTIONS,
  SERVICE_CATEGORY_OPTIONS,
} from '../business-categories';
import { CURRENCY_OPTIONS, DURATION_OPTIONS, TIMEZONE_OPTIONS } from '../form-options';
import type { BusinessProfileMemory, FaqRow, HoursRow, PolicyRow, ServiceRow } from '../business-profile-data';

const initial: ActionState = {};
const selectCls =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving...' : label}
    </Button>
  );
}

function StateMessage({ state }: { state: ActionState }) {
  return (
    <>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-emerald-600">Saved.</p> : null}
    </>
  );
}

export function BusinessMemoryForm({ profile }: { profile: BusinessProfileMemory }) {
  const [state, action] = useFormState(updateBusinessMemoryAction, initial);
  return (
    <form action={action} className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="shortDescription">Short business description</Label>
          <Textarea id="shortDescription" name="shortDescription" defaultValue={profile.shortDescription ?? ''} rows={3} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="uniqueSellingPoints">Why customers choose you</Label>
          <Textarea id="uniqueSellingPoints" name="uniqueSellingPoints" defaultValue={profile.uniqueSellingPoints ?? ''} rows={3} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="industry">Industry</Label>
          <Input id="industry" name="industry" defaultValue={profile.industry ?? ''} placeholder="restaurant, clinic, retail" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="targetCustomers">Target customers</Label>
          <Input id="targetCustomers" name="targetCustomers" defaultValue={profile.targetCustomers ?? ''} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="brandVoice">Brand voice</Label>
          <Input id="brandVoice" name="brandVoice" defaultValue={profile.brandVoice ?? ''} placeholder="premium, friendly, concise" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="defaultCurrency">Default currency</Label>
          <select id="defaultCurrency" name="defaultCurrency" className={selectCls} defaultValue={profile.defaultCurrency}>
            {!CURRENCY_OPTIONS.includes(profile.defaultCurrency) ? (
              <option value={profile.defaultCurrency}>{profile.defaultCurrency}</option>
            ) : null}
            {CURRENCY_OPTIONS.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="primaryPhone">Primary phone</Label>
          <Input id="primaryPhone" name="primaryPhone" defaultValue={profile.primaryPhone ?? ''} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="whatsapp">WhatsApp</Label>
          <Input id="whatsapp" name="whatsapp" defaultValue={profile.whatsapp ?? ''} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="supportEmail">Support email</Label>
          <Input id="supportEmail" name="supportEmail" type="email" defaultValue={profile.supportEmail ?? ''} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="salesEmail">Sales email</Label>
          <Input id="salesEmail" name="salesEmail" type="email" defaultValue={profile.salesEmail ?? ''} />
        </div>
        <div className="space-y-1.5 lg:col-span-2">
          <Label htmlFor="paymentMethods">Payment methods</Label>
          <Input id="paymentMethods" name="paymentMethods" defaultValue={profile.paymentMethods.join(', ')} placeholder="cash, card, bank transfer" />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="publicAddress">Public address</Label>
          <Textarea id="publicAddress" name="publicAddress" defaultValue={profile.publicAddress ?? ''} rows={2} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="serviceAreas">Service areas</Label>
          <Textarea id="serviceAreas" name="serviceAreas" defaultValue={profile.serviceAreas ?? ''} rows={2} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="escalationRules">Escalation rules</Label>
          <Textarea id="escalationRules" name="escalationRules" defaultValue={profile.escalationRules ?? ''} rows={3} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="leadQualificationRules">Lead qualification rules</Label>
          <Textarea id="leadQualificationRules" name="leadQualificationRules" defaultValue={profile.leadQualificationRules ?? ''} rows={3} />
        </div>
        <div className="space-y-1.5 lg:col-span-2">
          <Label htmlFor="appointmentRules">Appointment or booking rules</Label>
          <Textarea id="appointmentRules" name="appointmentRules" defaultValue={profile.appointmentRules ?? ''} rows={3} />
        </div>
      </div>
      <StateMessage state={state} />
      <Submit label="Save business memory" />
    </form>
  );
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function HoursForm({ hours }: { hours: HoursRow[] }) {
  const [state, action] = useFormState(updateHoursAction, initial);
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-3">
        {hours.map((h) => (
          <div key={h.dayOfWeek} className="grid gap-3 rounded-md border p-3 md:grid-cols-[120px_1fr_1fr_1fr_2fr]">
            <div className="text-sm font-medium">{DAYS[h.dayOfWeek]}</div>
            <label className="flex items-center gap-2 text-sm">
              <input name={`closed_${h.dayOfWeek}`} type="checkbox" defaultChecked={h.isClosed} className="h-4 w-4" />
              Closed
            </label>
            <Input name={`open_${h.dayOfWeek}`} type="time" defaultValue={h.openTime ?? ''} aria-label={`${DAYS[h.dayOfWeek]} open time`} />
            <Input name={`close_${h.dayOfWeek}`} type="time" defaultValue={h.closeTime ?? ''} aria-label={`${DAYS[h.dayOfWeek]} close time`} />
            <Input name={`notes_${h.dayOfWeek}`} defaultValue={h.notes ?? ''} placeholder="Notes" aria-label={`${DAYS[h.dayOfWeek]} notes`} />
          </div>
        ))}
      </div>
      <StateMessage state={state} />
      <Submit label="Save hours" />
    </form>
  );
}

export function LocationForm() {
  const [state, action] = useFormState(addLocationAction, initial);
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="name">Location name</Label>
          <Input id="name" name="name" required placeholder="Main branch" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" name="phone" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="timezone">Timezone</Label>
          <select id="timezone" name="timezone" className={selectCls} defaultValue="">
            <option value="">Use company timezone</option>
            {TIMEZONE_OPTIONS.map((timezone) => (
              <option key={timezone} value={timezone}>
                {timezone}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="addressLine1">Address line 1</Label>
          <Input id="addressLine1" name="addressLine1" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="addressLine2">Address line 2</Label>
          <Input id="addressLine2" name="addressLine2" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="city">City</Label>
          <Input id="city" name="city" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="region">Region</Label>
          <Input id="region" name="region" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="country">Country</Label>
          <Input id="country" name="country" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="postalCode">Postal code</Label>
          <Input id="postalCode" name="postalCode" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="googleMapsUrl">Google Maps URL</Label>
          <Input id="googleMapsUrl" name="googleMapsUrl" type="url" />
        </div>
        <div className="space-y-1.5 lg:col-span-2">
          <Label htmlFor="serviceArea">Service area</Label>
          <Input id="serviceArea" name="serviceArea" />
        </div>
      </div>
      <StateMessage state={state} />
      <Submit label="Add location" />
    </form>
  );
}

export function ServiceForm({ defaultCurrency }: { defaultCurrency: string }) {
  const [state, action] = useFormState(addServiceAction, initial);
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="serviceName">Service name</Label>
          <Input id="serviceName" name="name" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="serviceCategory">Offer type</Label>
          <select id="serviceCategory" name="category" className={selectCls} defaultValue="service">
            {SERVICE_CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="priceFrom">Price from</Label>
          <Input id="priceFrom" name="priceFrom" type="number" step="0.01" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="priceTo">Price to</Label>
          <Input id="priceTo" name="priceTo" type="number" step="0.01" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="currency">Currency</Label>
          <select id="currency" name="currency" className={selectCls} defaultValue={defaultCurrency}>
            {!CURRENCY_OPTIONS.includes(defaultCurrency) ? (
              <option value={defaultCurrency}>{defaultCurrency}</option>
            ) : null}
            {CURRENCY_OPTIONS.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="durationMinutes">Duration</Label>
          <select id="durationMinutes" name="durationMinutes" className={selectCls} defaultValue="">
            {DURATION_OPTIONS.map((option) => (
              <option key={option.value || 'none'} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <label className="mt-7 flex items-center gap-2 text-sm">
          <input name="bookingRequired" type="checkbox" className="h-4 w-4" />
          Booking required
        </label>
        <div className="space-y-1.5 lg:col-span-4">
          <Label htmlFor="description">Description</Label>
          <Textarea id="description" name="description" rows={3} />
        </div>
        <div className="space-y-1.5 lg:col-span-4">
          <Label htmlFor="requirements">Requirements</Label>
          <Textarea id="requirements" name="requirements" rows={2} />
        </div>
      </div>
      <StateMessage state={state} />
      <Submit label="Add service" />
    </form>
  );
}

export function EditServiceForm({ service, defaultCurrency }: { service: ServiceRow; defaultCurrency: string }) {
  const [state, action] = useFormState(updateServiceAction, initial);
  const currency = service.currency || defaultCurrency;
  return (
    <form action={action} className="mt-3 space-y-4 rounded-md border bg-muted/30 p-4">
      <input type="hidden" name="id" value={service.id} />
      <div className="grid gap-4 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor={`serviceName-${service.id}`}>Service name</Label>
          <Input id={`serviceName-${service.id}`} name="name" required defaultValue={service.name} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`serviceCategory-${service.id}`}>Offer type</Label>
          <select id={`serviceCategory-${service.id}`} name="category" className={selectCls} defaultValue={service.category ?? 'service'}>
            {SERVICE_CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`priceFrom-${service.id}`}>Price from</Label>
          <Input id={`priceFrom-${service.id}`} name="priceFrom" type="number" step="0.01" defaultValue={service.priceFrom ?? ''} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`priceTo-${service.id}`}>Price to</Label>
          <Input id={`priceTo-${service.id}`} name="priceTo" type="number" step="0.01" defaultValue={service.priceTo ?? ''} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`currency-${service.id}`}>Currency</Label>
          <select id={`currency-${service.id}`} name="currency" className={selectCls} defaultValue={currency}>
            {!CURRENCY_OPTIONS.includes(currency) ? <option value={currency}>{currency}</option> : null}
            {CURRENCY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`duration-${service.id}`}>Duration</Label>
          <select id={`duration-${service.id}`} name="durationMinutes" className={selectCls} defaultValue={service.durationMinutes ?? ''}>
            {DURATION_OPTIONS.map((option) => (
              <option key={option.value || 'none'} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <label className="mt-7 flex items-center gap-2 text-sm">
          <input name="bookingRequired" type="checkbox" defaultChecked={service.bookingRequired} className="h-4 w-4" />
          Booking required
        </label>
        <div className="space-y-1.5 lg:col-span-4">
          <Label htmlFor={`description-${service.id}`}>Description</Label>
          <Textarea id={`description-${service.id}`} name="description" rows={3} defaultValue={service.description ?? ''} />
        </div>
        <div className="space-y-1.5 lg:col-span-4">
          <Label htmlFor={`requirements-${service.id}`}>Requirements</Label>
          <Textarea id={`requirements-${service.id}`} name="requirements" rows={2} defaultValue={service.requirements ?? ''} />
        </div>
      </div>
      <StateMessage state={state} />
      <Submit label="Save service" />
    </form>
  );
}

export function PolicyForm() {
  const [state, action] = useFormState(addPolicyAction, initial);
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="policyTitle">Policy title</Label>
          <Input id="policyTitle" name="title" required placeholder="Refund policy" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="policyCategory">Category</Label>
          <select id="policyCategory" name="category" className={selectCls} defaultValue="general">
            {POLICY_CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="policyContent">Policy content</Label>
        <Textarea id="policyContent" name="content" rows={6} required />
      </div>
      <StateMessage state={state} />
      <Submit label="Add policy" />
    </form>
  );
}

export function EditPolicyForm({ policy }: { policy: PolicyRow }) {
  const [state, action] = useFormState(updatePolicyAction, initial);
  return (
    <form action={action} className="mt-3 space-y-4 rounded-md border bg-muted/30 p-4">
      <input type="hidden" name="id" value={policy.id} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor={`policyTitle-${policy.id}`}>Policy title</Label>
          <Input id={`policyTitle-${policy.id}`} name="title" required defaultValue={policy.title} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`policyCategory-${policy.id}`}>Category</Label>
          <select id={`policyCategory-${policy.id}`} name="category" className={selectCls} defaultValue={policy.category}>
            {POLICY_CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`policyContent-${policy.id}`}>Policy content</Label>
        <Textarea id={`policyContent-${policy.id}`} name="content" rows={6} required defaultValue={policy.content} />
      </div>
      <StateMessage state={state} />
      <Submit label="Save policy" />
    </form>
  );
}

export function FaqForm() {
  const [state, action] = useFormState(addFaqAction, initial);
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-1.5 lg:col-span-2">
          <Label htmlFor="question">Question</Label>
          <Input id="question" name="question" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="faqCategory">FAQ topic</Label>
          <select id="faqCategory" name="category" className={selectCls} defaultValue="general">
            {FAQ_CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="answer">Answer</Label>
        <Textarea id="answer" name="answer" rows={4} required />
      </div>
      <StateMessage state={state} />
      <Submit label="Add FAQ" />
    </form>
  );
}

export function EditFaqForm({ faq }: { faq: FaqRow }) {
  const [state, action] = useFormState(updateFaqAction, initial);
  return (
    <form action={action} className="mt-3 space-y-4 rounded-md border bg-muted/30 p-4">
      <input type="hidden" name="id" value={faq.id} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-1.5 lg:col-span-2">
          <Label htmlFor={`question-${faq.id}`}>Question</Label>
          <Input id={`question-${faq.id}`} name="question" required defaultValue={faq.question} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`faqCategory-${faq.id}`}>FAQ topic</Label>
          <select id={`faqCategory-${faq.id}`} name="category" className={selectCls} defaultValue={faq.category ?? 'general'}>
            {FAQ_CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`answer-${faq.id}`}>Answer</Label>
        <Textarea id={`answer-${faq.id}`} name="answer" rows={4} required defaultValue={faq.answer} />
      </div>
      <StateMessage state={state} />
      <Submit label="Save FAQ" />
    </form>
  );
}
