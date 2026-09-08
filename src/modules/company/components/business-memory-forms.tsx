'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/ui/form-field';
import { SectionHeader } from '@/components/ui/section-header';
import { cn } from '@/lib/utils';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { CHECKBOX, FIELD_GRID, FIELD_GRID_WIDE, FORM_SECTION, FULL_ROW } from './form-layout';
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
import { timezoneLabel } from '@/lib/constants';
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

/**
 * `dialCode` is spelled out here rather than taken from `BusinessProfileMemory`
 * because the reader that builds that type does not carry the column yet. An
 * optional field means the page can pass its profile object unchanged today,
 * and the box prefills itself the moment the reader starts returning it —
 * `undefined` (the reader never asked) and `null` (asked, nothing stored) are
 * different answers, and the hidden `dialCodeKnown` below tells the action
 * which of the two it is looking at.
 */
type BusinessMemoryFormProfile = BusinessProfileMemory & { dialCode?: string | null };

/**
 * The longest form in the configuration screens: twenty-one fields that decide
 * what the assistant knows about you and how it is allowed to speak.
 *
 * ## Two things were wrong with it
 *
 * **It was a wall.** Three unlabelled `<div>`s of fields, no headings, no
 * outline entry between "Short business description" and "What to ask before
 * taking a booking". A screen-reader user jumping by heading went from the
 * card title straight to the next card; a sighted one got twenty-one boxes and
 * no way to tell which four of them were about tone of voice. It is now four
 * `<section>`s with a real `<h3>` each, in the order somebody actually fills
 * one in: what you are → how to reach you → how to sound → when to stop and
 * fetch a person.
 *
 * **Two of its three grids measured the window.** `lg:grid-cols-2` fires at
 * 1024px — but this form renders inside the `xl:grid-cols-2` split on the
 * "Basics & hours" tab of `/company/business-data`, so from 1280px upward the
 * card holding it is about 510px of content and each of those two columns is
 * ~245px. `<Select>` cannot truncate: "Grounded: prefer company data" and
 * "Flexible: general help allowed" are ~30 characters, which at `text-sm` plus
 * `px-3` plus the platform arrow needs about 250px. They were clipping their
 * own text at exactly the widths a desktop user has. It is the same defect as
 * the `lg:grid-cols-4` row this file already fixed once, one notch smaller.
 *
 * So the grids come from `form-layout.ts` now and resolve against the CARD:
 * `FIELD_GRID_WIDE` (20rem floor) wherever a long `<option>` has to fit, plain
 * `FIELD_GRID` (16rem) for phone numbers and email addresses, and full width
 * for anything read as a sentence.
 */
export function BusinessMemoryForm({ profile }: { profile: BusinessMemoryFormProfile }) {
  const [state, action] = useFormState(updateBusinessMemoryAction, initial);
  return (
    <form action={action} className="space-y-8">
      <section aria-labelledby="bm-about" className={FORM_SECTION}>
        <SectionHeader
          id="bm-about"
          level={3}
          title="What your business is"
          description="The facts the assistant repeats back when somebody asks who you are and what you sell."
        />
        {/* Two paragraphs the owner writes in prose. `auto-fit` would happily
            give either a half-width column beside something unrelated; a
            sentence you compose belongs on its own full-width line. */}
        <FormField
          label="Short business description"
          htmlFor="shortDescription"
          hint="One or two sentences. This is the first thing the assistant reaches for when a visitor asks what you do."
        >
          <Textarea
            name="shortDescription"
            defaultValue={profile.shortDescription ?? ''}
            rows={3}
          />
        </FormField>
        <FormField
          label="Why customers choose you"
          htmlFor="uniqueSellingPoints"
          hint="What you would say to somebody comparing you with the shop next door."
        >
          <Textarea
            name="uniqueSellingPoints"
            defaultValue={profile.uniqueSellingPoints ?? ''}
            rows={3}
          />
        </FormField>
        <div className={FIELD_GRID}>
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
          <FormField
            label="Payment methods"
            htmlFor="paymentMethods"
            hint="Separate them with commas."
          >
            <Input
              name="paymentMethods"
              defaultValue={profile.paymentMethods.join(', ')}
              placeholder="cash, card, bank transfer"
            />
          </FormField>
          <FormField
            label="Default currency"
            htmlFor="defaultCurrency"
            hint="What a price is quoted in when a service does not set its own."
          >
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
      </section>

      <section aria-labelledby="bm-contact" className={FORM_SECTION}>
        <SectionHeader
          id="bm-contact"
          level={3}
          title="How customers reach you"
          description="Read out to anybody who asks how to call, message or find you."
        />
        <div className={FIELD_GRID}>
          {/* Phone boxes with no `type` get a full keyboard on a phone and no
              format guidance at all. The assistant reads these out to customers,
              so the country code is not optional. */}
          <FormField
            label="Primary phone"
            htmlFor="primaryPhone"
            hint="With the country code — the assistant reads this back to customers who ask how to call you."
          >
            <Input
              name="primaryPhone"
              type="tel"
              inputMode="tel"
              placeholder="+971 4 000 0000"
              defaultValue={profile.primaryPhone ?? ''}
            />
          </FormField>
          <input
            type="hidden"
            name="dialCodeKnown"
            value={profile.dialCode === undefined ? '' : '1'}
          />
          <FormField
            label="Country dial code"
            htmlFor="dialCode"
            hint="The calling code your customers dial from, on its own — it turns a number written nationally (07946 322081) into one WhatsApp can reach (+447946322081), and is how we recognise both as the same person. Left empty, a national number is kept exactly as it was typed rather than guessed at."
          >
            <Input
              id="dialCode"
              name="dialCode"
              type="tel"
              inputMode="tel"
              placeholder="+44"
              defaultValue={profile.dialCode ?? ''}
            />
          </FormField>
          <FormField
            label="WhatsApp"
            htmlFor="whatsapp"
            hint="Only if it is different from the number above."
          >
            <Input
              name="whatsapp"
              type="tel"
              inputMode="tel"
              placeholder="+971500000000"
              defaultValue={profile.whatsapp ?? ''}
            />
          </FormField>
          <FormField label="Support email" htmlFor="supportEmail">
            <Input name="supportEmail" type="email" defaultValue={profile.supportEmail ?? ''} />
          </FormField>
          <FormField label="Sales email" htmlFor="salesEmail">
            <Input name="salesEmail" type="email" defaultValue={profile.salesEmail ?? ''} />
          </FormField>
        </div>
        <FormField
          label="Public address"
          htmlFor="publicAddress"
          hint="The address you are happy for the assistant to give out. Individual branches go on the “Where you are” card."
        >
          <Textarea name="publicAddress" defaultValue={profile.publicAddress ?? ''} rows={2} />
        </FormField>
        <FormField
          label="Service areas"
          htmlFor="serviceAreas"
          hint="Where you deliver or travel to, so the assistant can answer “do you cover me?”."
        >
          <Textarea name="serviceAreas" defaultValue={profile.serviceAreas ?? ''} rows={2} />
        </FormField>
      </section>

      <section aria-labelledby="bm-voice" className={FORM_SECTION}>
        <SectionHeader
          id="bm-voice"
          level={3}
          title="How it should sound"
          description="How long the answers are, how closely they stick to what you have saved, and how hard they sell."
        />
        {/* `FIELD_GRID_WIDE`, not `FIELD_GRID`: three of these five are selects
            whose longest option is a short sentence, and a native select cuts
            its text off mid-word rather than truncating politely. A 20rem floor
            is what guarantees "Grounded: prefer company data" fits. */}
        <div className={FIELD_GRID_WIDE}>
          <FormField label="Brand voice" htmlFor="brandVoice" hint="A few adjectives is enough.">
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
          <FormField
            label="Fact strictness"
            htmlFor="answerStrictness"
            hint="Strict is the safest: the assistant says it does not know rather than filling a gap."
          >
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
        </div>
        <FormField
          label="Banned phrases"
          htmlFor="bannedPhrases"
          hint="Words the assistant must never use, separated by commas."
        >
          <Input
            name="bannedPhrases"
            defaultValue={profile.bannedPhrases.join(', ')}
            placeholder="cheap, no problem, dear customer"
          />
        </FormField>
        <FormField
          label="Tone notes"
          htmlFor="toneNotes"
          hint="Anything the four settings above do not cover — how to greet people, whether to use first names, when to apologise."
        >
          <Textarea name="toneNotes" defaultValue={profile.toneNotes ?? ''} rows={3} />
        </FormField>
      </section>

      <section aria-labelledby="bm-handoff" className={FORM_SECTION}>
        <SectionHeader
          id="bm-handoff"
          level={3}
          title="When to bring in a person"
          description="The three rules that decide when the assistant stops answering, and what it collects before it does."
        />
        {/* Every field here is a paragraph of instructions the owner reads back
            to themselves as prose. None of them belongs in a column. */}
        <RuleField
          name="escalationRules"
          label="When to pass it to a person"
          hint="Decides when the assistant stops answering and brings in a person."
          suggestion={RULE_SUGGESTIONS.escalationRules}
          defaultValue={profile.escalationRules ?? ''}
        />
        <FormField
          label="What it says when passing it on"
          htmlFor="escalationMessage"
          hint="The exact words the customer sees while they wait for somebody."
        >
          <Textarea
            name="escalationMessage"
            defaultValue={profile.escalationMessage ?? ''}
            rows={3}
          />
        </FormField>
        <RuleField
          name="leadQualificationRules"
          label="What to ask an interested customer"
          hint="What the assistant asks before it takes somebody’s details for you to follow up."
          suggestion={RULE_SUGGESTIONS.leadQualificationRules}
          defaultValue={profile.leadQualificationRules ?? ''}
        />
        <RuleField
          name="appointmentRules"
          label="What to ask before taking a booking"
          hint="Decides what the assistant asks before it passes a booking request to the team."
          suggestion={RULE_SUGGESTIONS.appointmentRules}
          defaultValue={profile.appointmentRules ?? ''}
        />
      </section>

      {/* The result and the button sit outside the last section, so neither is
          announced as part of "When to bring in a person" — they belong to the
          whole form, and the rule above them says so. */}
      <div className="space-y-4 border-t pt-6">
        <FormMessage state={state} />
        <SubmitButton pendingLabel="Saving…">Save your business details</SubmitButton>
      </div>
    </form>
  );
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function HoursForm({ hours }: { hours: HoursRow[] }) {
  const [state, action] = useFormState(updateHoursAction, initial);
  return (
    <form action={action} className="space-y-4">
      {/*
        THE WORST SINGLE ROW IN THE CONFIGURATION SCREENS
        -------------------------------------------------
        This was `md:grid-cols-[120px_1fr_1fr_1fr_2fr]` — five fixed tracks
        switched on by a VIEWPORT query at 768px. The form renders in the 1fr
        side of the `lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]` split on
        `/company/business-data`, which is about 445px of card content. Take the
        padding and gaps off and the four fractional tracks shared ~313px in the
        ratio 1:1:1:2 — so each `<input type="time">` got about 62px. A time
        input cannot render `--:-- --` in 62px in any browser; both of them were
        clipped, on every desktop, on the tab where a shop sets its opening
        hours.

        Two things fixed it. The fields now sit in an `auto-fit` grid with an
        8rem floor, so they wrap to however many columns the card can genuinely
        give them (three at 445px, one at 375px) and never below a width a time
        input can render in. And the day name became a real `<legend>` with each
        field carrying a VISIBLE label rather than an `aria-label` only — there
        were no column headings anywhere, so a sighted user was left inferring
        from position which of two identical time boxes was opening and which
        was closing.
      */}
      <div className="space-y-3">
        {hours.map((h) => {
          const day = DAYS[h.dayOfWeek];
          return (
            <fieldset key={h.dayOfWeek} className="space-y-3 rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <legend className="float-start text-sm font-medium">{day}</legend>
                <label className="ms-auto flex items-center gap-2 text-sm">
                  <input
                    name={`closed_${h.dayOfWeek}`}
                    type="checkbox"
                    defaultChecked={h.isClosed}
                    className={CHECKBOX}
                  />
                  Closed all day
                </label>
              </div>
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(8rem,1fr))]">
                <FormField label="Opens" htmlFor={`open_${h.dayOfWeek}`}>
                  <Input name={`open_${h.dayOfWeek}`} type="time" defaultValue={h.openTime ?? ''} />
                </FormField>
                <FormField label="Closes" htmlFor={`close_${h.dayOfWeek}`}>
                  <Input
                    name={`close_${h.dayOfWeek}`}
                    type="time"
                    defaultValue={h.closeTime ?? ''}
                  />
                </FormField>
                <FormField label="Note" htmlFor={`notes_${h.dayOfWeek}`}>
                  <Input
                    name={`notes_${h.dayOfWeek}`}
                    defaultValue={h.notes ?? ''}
                    placeholder="Kitchen closes 21:00"
                  />
                </FormField>
              </div>
            </fieldset>
          );
        })}
      </div>
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Saving…">Save hours</SubmitButton>
    </form>
  );
}

export function LocationForm() {
  const [state, action] = useFormState(addLocationAction, initial);
  return (
    <form action={action} className="space-y-4">
      <div className={FIELD_GRID}>
        <FormField label="Location name" htmlFor="name" required>
          <Input name="name" required placeholder="Main branch" />
        </FormField>
        <FormField label="Phone" htmlFor="phone" hint="The number for this branch.">
          <Input name="phone" type="tel" inputMode="tel" placeholder="+971 4 000 0000" />
        </FormField>
        {/* Raw IANA ids — `Asia/Dubai`, `America/New_York` — were printed
            verbatim in a list of several hundred. `timezoneLabel` puts the
            place first and keeps the id, so it is both readable and findable.
            The submitted value is byte-identical.

            The hint matters more than the labels: this column, not the one on
            the company profile, is what `src/lib/sla/index.ts:107` and
            `src/lib/business-hours.ts:40` read for the primary location. */}
        <FormField
          label="Time zone"
          htmlFor="timezone"
          hint="Leave this on the company setting unless this branch is genuinely in another zone. For your main branch this is the zone your opening hours and reply-time clocks are actually counted in."
        >
          <Select name="timezone" defaultValue="">
            <option value="">Same as the company time zone</option>
            {TIMEZONE_OPTIONS.map((timezone) => (
              <option key={timezone} value={timezone}>
                {timezoneLabel(timezone)}
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
        {/*
          These two are saved and never used. `src/lib/ai/business-context.ts`
          builds each location line the assistant can quote from `name`,
          `address_line1/2`, `city`, `region`, `country`, `phone` and
          `service_area` only (`:131-136`) — `google_maps_url` is selected at
          `:69` and then dropped, and `postal_code` is not even selected. Neither
          appears in the locations table on the page either. They are kept
          editable, because the columns are real and one line of prompt work
          would use them, but the label no longer implies the assistant will
          repeat them to a customer who asks.
        */}
        <FormField
          label="Postal code — kept on file only"
          htmlFor="postalCode"
          hint="Stored with the address, but the assistant does not currently include it when it gives a customer your address."
        >
          <Input name="postalCode" />
        </FormField>
        <FormField
          label="Google Maps link — kept on file only"
          htmlFor="googleMapsUrl"
          hint="Saved, but not yet passed to the assistant, so it will not send a customer this link. Put directions in an FAQ answer if you need it said."
        >
          <Input name="googleMapsUrl" type="url" placeholder="https://maps.app.goo.gl/…" />
        </FormField>
        <FormField
          label="Service area"
          htmlFor="serviceArea"
          className={FULL_ROW}
          hint="Where this branch will actually travel to or deliver. The assistant quotes this when a customer asks whether you cover them."
        >
          <Input name="serviceArea" placeholder="Within 10 miles of the city centre" />
        </FormField>
      </div>
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Saving…">Add location</SubmitButton>
    </form>
  );
}

export function ServiceForm({ defaultCurrency }: { defaultCurrency: string }) {
  const [state, action] = useFormState(addServiceAction, initial);
  return (
    <form action={action} className="space-y-4">
      {/* Two across, not four. `lg:` measures the VIEWPORT, but this form sits in
          the narrow column of a 1.5fr/1fr split, so a four-column row here was
          about 110px per field on a full-width screen — wide enough to clip a
          select's own text. Anything with a long label spans the row. */}
      <div className={FIELD_GRID}>
        <FormField
          label="Service, product, or appointment option"
          htmlFor="serviceName"
          className={FULL_ROW}
          required
        >
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
        <label className={cn('flex items-center gap-2 text-sm', FULL_ROW)}>
          <input name="bookingRequired" type="checkbox" className={CHECKBOX} />
          Visitor can request or book this
        </label>
        <FormField
          label="What should the assistant say about it?"
          htmlFor="description"
          className={FULL_ROW}
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
          className={FULL_ROW}
        >
          <Textarea
            name="requirements"
            rows={2}
            placeholder="For example location, number of tills, current provider, preferred date, or business type."
          />
        </FormField>
      </div>
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Saving…">Add service</SubmitButton>
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
      <div className={FIELD_GRID}>
        <FormField
          label="Service, product, or appointment option"
          htmlFor={`serviceName-${service.id}`}
          required
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
        {/* `mt-7` was a 28px nudge trying to drop this box level with the
            bottom of whichever control happened to sit beside it. In an
            `auto-fit` grid nothing is guaranteed to sit beside it — at 375px
            there is one column — so the nudge became a 28px hole above a tick
            box. Its own row instead, with the same wording as the add form:
            the two said "request or book" and "request/book" for one control. */}
        <label className={cn('flex items-center gap-2 text-sm', FULL_ROW)}>
          <input
            name="bookingRequired"
            type="checkbox"
            defaultChecked={service.bookingRequired}
            className={CHECKBOX}
          />
          Visitor can request or book this
        </label>
        <FormField
          label="What should the assistant say about it?"
          htmlFor={`description-${service.id}`}
          className={FULL_ROW}
        >
          <Textarea name="description" rows={3} defaultValue={service.description ?? ''} />
        </FormField>
        <FormField
          label="What should the visitor provide?"
          htmlFor={`requirements-${service.id}`}
          className={FULL_ROW}
        >
          <Textarea name="requirements" rows={2} defaultValue={service.requirements ?? ''} />
        </FormField>
      </div>
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Saving…">Save service</SubmitButton>
    </form>
  );
}

export function PolicyForm() {
  const [state, action] = useFormState(addPolicyAction, initial);
  return (
    <form action={action} className="space-y-4">
      <div className={FIELD_GRID}>
        <FormField label="Policy title" htmlFor="policyTitle" required>
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
      <FormField label="Policy content" htmlFor="policyContent" required>
        <Textarea name="content" rows={6} required />
      </FormField>
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Saving…">Add policy</SubmitButton>
    </form>
  );
}

export function EditPolicyForm({ policy }: { policy: PolicyRow }) {
  const [state, action] = useFormState(updatePolicyAction, initial);
  return (
    <form action={action} className="mt-3 space-y-4 rounded-md border bg-muted/30 p-4">
      <input type="hidden" name="id" value={policy.id} />
      <div className={FIELD_GRID}>
        <FormField label="Policy title" htmlFor={`policyTitle-${policy.id}`} required>
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
      <FormField label="Policy content" htmlFor={`policyContent-${policy.id}`} required>
        <Textarea name="content" rows={6} required defaultValue={policy.content} />
      </FormField>
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Saving…">Save policy</SubmitButton>
    </form>
  );
}

export function FaqForm() {
  const [state, action] = useFormState(addFaqAction, initial);
  return (
    <form action={action} className="space-y-4">
      <div className={FIELD_GRID}>
        <FormField label="Question" htmlFor="question" className={FULL_ROW} required>
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
      <FormField label="Answer" htmlFor="answer" required>
        <Textarea name="answer" rows={4} required />
      </FormField>
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Saving…">Add FAQ</SubmitButton>
    </form>
  );
}

export function EditFaqForm({ faq }: { faq: FaqRow }) {
  const [state, action] = useFormState(updateFaqAction, initial);
  return (
    <form action={action} className="mt-3 space-y-4 rounded-md border bg-muted/30 p-4">
      <input type="hidden" name="id" value={faq.id} />
      <div className={FIELD_GRID}>
        <FormField label="Question" htmlFor={`question-${faq.id}`} className={FULL_ROW} required>
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
      <FormField label="Answer" htmlFor={`answer-${faq.id}`} required>
        <Textarea name="answer" rows={4} required defaultValue={faq.answer} />
      </FormField>
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Saving…">Save FAQ</SubmitButton>
    </form>
  );
}
