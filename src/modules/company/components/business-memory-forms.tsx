'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
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
import type {
  BusinessProfileMemory,
  FaqRow,
  HoursRow,
  PolicyRow,
  ServiceRow,
} from '../business-profile-data';

const initial: ActionState = {};

/**
 * Starter wording for the three rules that gate human handoff, lead capture, and
 * booking readiness. Kept as hint text plus a one-click insert: silently
 * prefilling would satisfy the launch check with a policy nobody has read.
 */
const RULE_SUGGESTIONS = {
  escalationRules:
    'Hand over to a person when the visitor asks for one, raises a complaint, or asks something we have no answer for. Take their name and the best way to reach them, then tell them when the team will reply.',
  leadQualificationRules:
    'Treat anyone who asks for prices, a quote, or a callback as a lead. Ask what they need and when they need it, then take a name plus a phone number or email before promising a reply.',
  appointmentRules:
    'Ask which service the visitor wants, then offer a day and time inside our opening hours. Take a name and a phone number or email, and say the booking is confirmed once a team member replies. Ask for at least 24 hours of notice to change or cancel.',
} as const;

/**
 * Free textarea with editable starter wording. The suggestion shows as hint text
 * until the user inserts it, so the saved value is always one they chose.
 *
 * Deliberately not built on `FormField`: the hint here shares a row with the
 * "Use this wording" button, whereas `FormField` renders its hint as a plain
 * paragraph below the control. It is already a single shared component, so
 * there is no duplication to collapse.
 */
function RuleField({
  name,
  label,
  hint,
  suggestion,
  defaultValue,
  className,
}: {
  name: string;
  label: string;
  hint: string;
  suggestion: string;
  defaultValue: string;
  className?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label htmlFor={name}>{label}</Label>
      <Textarea
        id={name}
        name={name}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={suggestion}
        rows={4}
      />
      <div className="flex flex-wrap items-center gap-2">
        {value.trim() ? null : (
          <Button type="button" variant="outline" size="sm" onClick={() => setValue(suggestion)}>
            Use this wording
          </Button>
        )}
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

export function BusinessMemoryForm({ profile }: { profile: BusinessProfileMemory }) {
  const [state, action] = useFormState(updateBusinessMemoryAction, initial);
  return (
    <form action={action} className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-2">
        <FormField label="Short business description" htmlFor="shortDescription">
          <Textarea
            name="shortDescription"
            defaultValue={profile.shortDescription ?? ''}
            rows={3}
          />
        </FormField>
        <FormField label="Why customers choose you" htmlFor="uniqueSellingPoints">
          <Textarea
            name="uniqueSellingPoints"
            defaultValue={profile.uniqueSellingPoints ?? ''}
            rows={3}
          />
        </FormField>
        <FormField label="Industry" htmlFor="industry">
          <Input
            name="industry"
            defaultValue={profile.industry ?? ''}
            placeholder="restaurant, clinic, retail"
          />
        </FormField>
        <FormField label="Target customers" htmlFor="targetCustomers">
          <Input name="targetCustomers" defaultValue={profile.targetCustomers ?? ''} />
        </FormField>
        <FormField label="Brand voice" htmlFor="brandVoice">
          <Input
            name="brandVoice"
            defaultValue={profile.brandVoice ?? ''}
            placeholder="premium, friendly, concise"
          />
        </FormField>
        <FormField label="Answer length" htmlFor="answerLength">
          <Select name="answerLength" defaultValue={profile.answerLength}>
            <option value="short">Short</option>
            <option value="balanced">Balanced</option>
            <option value="detailed">Detailed</option>
          </Select>
        </FormField>
        <FormField label="Fact strictness" htmlFor="answerStrictness">
          <Select name="answerStrictness" defaultValue={profile.answerStrictness}>
            <option value="strict">Strict: only company data</option>
            <option value="grounded">Grounded: prefer company data</option>
            <option value="flexible">Flexible: general help allowed</option>
          </Select>
        </FormField>
        <FormField label="Sales style" htmlFor="salesStyle">
          <Select name="salesStyle" defaultValue={profile.salesStyle}>
            <option value="support_only">Support only</option>
            <option value="helpful">Helpful recommendations</option>
            <option value="sales_focused">Sales focused</option>
          </Select>
        </FormField>
        <FormField label="Banned phrases" htmlFor="bannedPhrases">
          <Input
            name="bannedPhrases"
            defaultValue={profile.bannedPhrases.join(', ')}
            placeholder="cheap, no problem, dear customer"
          />
        </FormField>
        <FormField label="Default currency" htmlFor="defaultCurrency">
          <Select name="defaultCurrency" defaultValue={profile.defaultCurrency}>
            {!CURRENCY_OPTIONS.includes(profile.defaultCurrency) ? (
              <option value={profile.defaultCurrency}>{profile.defaultCurrency}</option>
            ) : null}
            {CURRENCY_OPTIONS.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </Select>
        </FormField>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <FormField label="Primary phone" htmlFor="primaryPhone">
          <Input name="primaryPhone" defaultValue={profile.primaryPhone ?? ''} />
        </FormField>
        <FormField label="WhatsApp" htmlFor="whatsapp">
          <Input name="whatsapp" defaultValue={profile.whatsapp ?? ''} />
        </FormField>
        <FormField label="Support email" htmlFor="supportEmail">
          <Input name="supportEmail" type="email" defaultValue={profile.supportEmail ?? ''} />
        </FormField>
        <FormField label="Sales email" htmlFor="salesEmail">
          <Input name="salesEmail" type="email" defaultValue={profile.salesEmail ?? ''} />
        </FormField>
        <FormField label="Payment methods" htmlFor="paymentMethods" className="lg:col-span-2">
          <Input
            name="paymentMethods"
            defaultValue={profile.paymentMethods.join(', ')}
            placeholder="cash, card, bank transfer"
          />
        </FormField>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <FormField label="Public address" htmlFor="publicAddress">
          <Textarea name="publicAddress" defaultValue={profile.publicAddress ?? ''} rows={2} />
        </FormField>
        <FormField label="Service areas" htmlFor="serviceAreas">
          <Textarea name="serviceAreas" defaultValue={profile.serviceAreas ?? ''} rows={2} />
        </FormField>
        <RuleField
          name="escalationRules"
          label="When to pass it to a person"
          hint="Decides when the assistant stops answering and brings in a person."
          suggestion={RULE_SUGGESTIONS.escalationRules}
          defaultValue={profile.escalationRules ?? ''}
        />
        <FormField label="What it says when passing it on" htmlFor="escalationMessage">
          <Textarea
            name="escalationMessage"
            defaultValue={profile.escalationMessage ?? ''}
            rows={3}
          />
        </FormField>
        <FormField label="Tone notes" htmlFor="toneNotes" className="lg:col-span-2">
          <Textarea name="toneNotes" defaultValue={profile.toneNotes ?? ''} rows={3} />
        </FormField>
        <RuleField
          name="leadQualificationRules"
          label="What to ask an interested customer"
          hint="What the assistant asks before it takes someone’s details for you to follow up."
          suggestion={RULE_SUGGESTIONS.leadQualificationRules}
          defaultValue={profile.leadQualificationRules ?? ''}
        />
        <RuleField
          name="appointmentRules"
          label="What to ask before taking a booking"
          hint="Decides what the assistant asks before it passes a booking request to the team."
          suggestion={RULE_SUGGESTIONS.appointmentRules}
          defaultValue={profile.appointmentRules ?? ''}
          className="lg:col-span-2"
        />
      </div>
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Saving...">Save your business details</SubmitButton>
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
          <div
            key={h.dayOfWeek}
            className="grid gap-3 rounded-md border p-3 md:grid-cols-[120px_1fr_1fr_1fr_2fr]"
          >
            <div className="text-sm font-medium">{DAYS[h.dayOfWeek]}</div>
            <label className="flex items-center gap-2 text-sm">
              <input
                name={`closed_${h.dayOfWeek}`}
                type="checkbox"
                defaultChecked={h.isClosed}
                className="h-4 w-4"
              />
              Closed
            </label>
            <Input
              name={`open_${h.dayOfWeek}`}
              type="time"
              defaultValue={h.openTime ?? ''}
              aria-label={`${DAYS[h.dayOfWeek]} open time`}
            />
            <Input
              name={`close_${h.dayOfWeek}`}
              type="time"
              defaultValue={h.closeTime ?? ''}
              aria-label={`${DAYS[h.dayOfWeek]} close time`}
            />
            <Input
              name={`notes_${h.dayOfWeek}`}
              defaultValue={h.notes ?? ''}
              placeholder="Notes"
              aria-label={`${DAYS[h.dayOfWeek]} notes`}
            />
          </div>
        ))}
      </div>
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Saving...">Save hours</SubmitButton>
    </form>
  );
}

export function LocationForm() {
  const [state, action] = useFormState(addLocationAction, initial);
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <FormField label="Location name" htmlFor="name">
          <Input name="name" required placeholder="Main branch" />
        </FormField>
        <FormField label="Phone" htmlFor="phone">
          <Input name="phone" />
        </FormField>
        <FormField label="Timezone" htmlFor="timezone">
          <Select name="timezone" defaultValue="">
            <option value="">Use company timezone</option>
            {TIMEZONE_OPTIONS.map((timezone) => (
              <option key={timezone} value={timezone}>
                {timezone}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Address line 1" htmlFor="addressLine1">
          <Input name="addressLine1" />
        </FormField>
        <FormField label="Address line 2" htmlFor="addressLine2">
          <Input name="addressLine2" />
        </FormField>
        <FormField label="City" htmlFor="city">
          <Input name="city" />
        </FormField>
        <FormField label="Region" htmlFor="region">
          <Input name="region" />
        </FormField>
        <FormField label="Country" htmlFor="country">
          <Input name="country" />
        </FormField>
        <FormField label="Postal code" htmlFor="postalCode">
          <Input name="postalCode" />
        </FormField>
        <FormField label="Google Maps URL" htmlFor="googleMapsUrl">
          <Input name="googleMapsUrl" type="url" />
        </FormField>
        <FormField label="Service area" htmlFor="serviceArea" className="lg:col-span-2">
          <Input name="serviceArea" />
        </FormField>
      </div>
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Saving...">Add location</SubmitButton>
    </form>
  );
}

export function ServiceForm({ defaultCurrency }: { defaultCurrency: string }) {
  const [state, action] = useFormState(addServiceAction, initial);
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-4">
        <FormField label="Service, product, or appointment option" htmlFor="serviceName">
          <Input
            name="name"
            required
            placeholder="Product demo, installation visit, consultation, support call"
          />
        </FormField>
        <FormField label="Offer type" htmlFor="serviceCategory">
          <Select name="category" defaultValue="service">
            {SERVICE_CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Price from" htmlFor="priceFrom">
          <Input name="priceFrom" type="number" step="0.01" />
        </FormField>
        <FormField label="Price to" htmlFor="priceTo">
          <Input name="priceTo" type="number" step="0.01" />
        </FormField>
        <FormField label="Currency" htmlFor="currency">
          <Select name="currency" defaultValue={defaultCurrency}>
            {!CURRENCY_OPTIONS.includes(defaultCurrency) ? (
              <option value={defaultCurrency}>{defaultCurrency}</option>
            ) : null}
            {CURRENCY_OPTIONS.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Typical duration" htmlFor="durationMinutes">
          <Select name="durationMinutes" defaultValue="">
            {DURATION_OPTIONS.map((option) => (
              <option key={option.value || 'none'} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </FormField>
        <label className="mt-7 flex items-center gap-2 text-sm">
          <input name="bookingRequired" type="checkbox" className="h-4 w-4" />
          Visitor can request/book this
        </label>
        <FormField
          label="What should the assistant say about it?"
          htmlFor="description"
          className="lg:col-span-4"
        >
          <Textarea
            name="description"
            rows={3}
            placeholder="Who it is for, what is included, and any useful price or package details."
          />
        </FormField>
        <FormField
          label="What should the visitor provide?"
          htmlFor="requirements"
          className="lg:col-span-4"
        >
          <Textarea
            name="requirements"
            rows={2}
            placeholder="For example location, number of tills, current provider, preferred date, or business type."
          />
        </FormField>
      </div>
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Saving...">Add service</SubmitButton>
    </form>
  );
}

export function EditServiceForm({
  service,
  defaultCurrency,
}: {
  service: ServiceRow;
  defaultCurrency: string;
}) {
  const [state, action] = useFormState(updateServiceAction, initial);
  const currency = service.currency || defaultCurrency;
  return (
    <form action={action} className="mt-3 space-y-4 rounded-md border bg-muted/30 p-4">
      <input type="hidden" name="id" value={service.id} />
      <div className="grid gap-4 lg:grid-cols-4">
        <FormField
          label="Service, product, or appointment option"
          htmlFor={`serviceName-${service.id}`}
        >
          <Input name="name" required defaultValue={service.name} />
        </FormField>
        <FormField label="Offer type" htmlFor={`serviceCategory-${service.id}`}>
          <Select name="category" defaultValue={service.category ?? 'service'}>
            {SERVICE_CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Price from" htmlFor={`priceFrom-${service.id}`}>
          <Input
            name="priceFrom"
            type="number"
            step="0.01"
            defaultValue={service.priceFrom ?? ''}
          />
        </FormField>
        <FormField label="Price to" htmlFor={`priceTo-${service.id}`}>
          <Input name="priceTo" type="number" step="0.01" defaultValue={service.priceTo ?? ''} />
        </FormField>
        <FormField label="Currency" htmlFor={`currency-${service.id}`}>
          <Select name="currency" defaultValue={currency}>
            {!CURRENCY_OPTIONS.includes(currency) ? (
              <option value={currency}>{currency}</option>
            ) : null}
            {CURRENCY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Typical duration" htmlFor={`duration-${service.id}`}>
          <Select name="durationMinutes" defaultValue={service.durationMinutes ?? ''}>
            {DURATION_OPTIONS.map((option) => (
              <option key={option.value || 'none'} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </FormField>
        <label className="mt-7 flex items-center gap-2 text-sm">
          <input
            name="bookingRequired"
            type="checkbox"
            defaultChecked={service.bookingRequired}
            className="h-4 w-4"
          />
          Visitor can request/book this
        </label>
        <FormField
          label="What should the assistant say about it?"
          htmlFor={`description-${service.id}`}
          className="lg:col-span-4"
        >
          <Textarea name="description" rows={3} defaultValue={service.description ?? ''} />
        </FormField>
        <FormField
          label="What should the visitor provide?"
          htmlFor={`requirements-${service.id}`}
          className="lg:col-span-4"
        >
          <Textarea name="requirements" rows={2} defaultValue={service.requirements ?? ''} />
        </FormField>
      </div>
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Saving...">Save service</SubmitButton>
    </form>
  );
}

export function PolicyForm() {
  const [state, action] = useFormState(addPolicyAction, initial);
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <FormField label="Policy title" htmlFor="policyTitle">
          <Input name="title" required placeholder="Refund policy" />
        </FormField>
        <FormField label="Category" htmlFor="policyCategory">
          <Select name="category" defaultValue="general">
            {POLICY_CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      <FormField label="Policy content" htmlFor="policyContent">
        <Textarea name="content" rows={6} required />
      </FormField>
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Saving...">Add policy</SubmitButton>
    </form>
  );
}

export function EditPolicyForm({ policy }: { policy: PolicyRow }) {
  const [state, action] = useFormState(updatePolicyAction, initial);
  return (
    <form action={action} className="mt-3 space-y-4 rounded-md border bg-muted/30 p-4">
      <input type="hidden" name="id" value={policy.id} />
      <div className="grid gap-4 lg:grid-cols-3">
        <FormField label="Policy title" htmlFor={`policyTitle-${policy.id}`}>
          <Input name="title" required defaultValue={policy.title} />
        </FormField>
        <FormField label="Category" htmlFor={`policyCategory-${policy.id}`}>
          <Select name="category" defaultValue={policy.category}>
            {POLICY_CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      <FormField label="Policy content" htmlFor={`policyContent-${policy.id}`}>
        <Textarea name="content" rows={6} required defaultValue={policy.content} />
      </FormField>
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Saving...">Save policy</SubmitButton>
    </form>
  );
}

export function FaqForm() {
  const [state, action] = useFormState(addFaqAction, initial);
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <FormField label="Question" htmlFor="question" className="lg:col-span-2">
          <Input name="question" required />
        </FormField>
        <FormField label="FAQ topic" htmlFor="faqCategory">
          <Select name="category" defaultValue="general">
            {FAQ_CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      <FormField label="Answer" htmlFor="answer">
        <Textarea name="answer" rows={4} required />
      </FormField>
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Saving...">Add FAQ</SubmitButton>
    </form>
  );
}

export function EditFaqForm({ faq }: { faq: FaqRow }) {
  const [state, action] = useFormState(updateFaqAction, initial);
  return (
    <form action={action} className="mt-3 space-y-4 rounded-md border bg-muted/30 p-4">
      <input type="hidden" name="id" value={faq.id} />
      <div className="grid gap-4 lg:grid-cols-3">
        <FormField label="Question" htmlFor={`question-${faq.id}`} className="lg:col-span-2">
          <Input name="question" required defaultValue={faq.question} />
        </FormField>
        <FormField label="FAQ topic" htmlFor={`faqCategory-${faq.id}`}>
          <Select name="category" defaultValue={faq.category ?? 'general'}>
            {FAQ_CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      <FormField label="Answer" htmlFor={`answer-${faq.id}`}>
        <Textarea name="answer" rows={4} required defaultValue={faq.answer} />
      </FormField>
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Saving...">Save FAQ</SubmitButton>
    </form>
  );
}
