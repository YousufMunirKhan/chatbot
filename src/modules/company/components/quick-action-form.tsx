'use client';

import { useMemo, useState, type ComponentType } from 'react';
import { useFormState } from 'react-dom';
import {
  Bot,
  CalendarDays,
  ExternalLink,
  FileText,
  HelpCircle,
  MessageSquare,
  Phone,
  Plus,
  Trash2,
  UserRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  QUICK_ACTION_AUDIENCE_LABELS,
  QUICK_ACTION_CONTEXT_LABELS,
  QUICK_ACTION_MOMENT_LABELS,
  QUICK_ACTION_TYPE_LABELS,
  labelFor,
} from '@/lib/constants';
import { cn } from '@/lib/utils';
import type { QuickActionType } from '@/lib/quick-actions';
import type { BotRow } from '../data';
import { saveQuickActionAction, type QuickActionState } from '../quick-actions-actions';
import type { QuickActionRow } from '../quick-actions-data';
import { Select } from '@/components/ui/select';
import { CHECKBOX, CHOICE_CARD, CHOICE_GRID, FIELD_GRID } from './form-layout';

const initial: QuickActionState = {};

/**
 * Every user-facing name below comes from the shared `QUICK_ACTION_*` maps via
 * `labelFor`, so this builder and the Chat buttons list describe the same stored
 * value the same way. They each used to keep their own table and they disagreed:
 * `send_message` read "Send message" here and "Message" there.
 *
 * The *values* stay listed here rather than being derived from those maps. The
 * maps are the platform's whole vocabulary; this form only knows how to collect
 * the extra details for the eight types below, so offering one it has no fields
 * for would save a button that does nothing.
 */
const ACTION_OPTIONS: Array<{
  value: QuickActionType;
  description: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  {
    value: 'send_message',
    description: 'The chat opens with a message you write, already sent for them.',
    icon: MessageSquare,
  },
  {
    value: 'direct_answer',
    description: 'Shows wording you saved, word for word. The assistant does not rewrite it.',
    icon: FileText,
  },
  {
    value: 'lead_form',
    description: 'Asks for a name and a way to contact them, and files it under Leads.',
    icon: UserRound,
  },
  {
    value: 'appointment_form',
    description: 'Asks for the day and time they want, and files it under Bookings.',
    icon: CalendarDays,
  },
  {
    value: 'external_link',
    description: 'Sends them to a page on your website.',
    icon: ExternalLink,
  },
  {
    value: 'whatsapp',
    description: 'Opens WhatsApp with your number already filled in.',
    icon: Phone,
  },
  { value: 'phone_call', description: 'Rings you straight away from their phone.', icon: Phone },
  {
    value: 'request_human',
    description: 'Asks one of your team to take the chat over from the assistant.',
    icon: HelpCircle,
  },
];

/**
 * The moments a button may be offered in. Words come from
 * `QUICK_ACTION_MOMENT_LABELS`, which the Chat buttons list reads too, so the
 * two screens cannot disagree about what `after_answer` means.
 */
const CONTEXT_VALUES = [
  'initial',
  'after_answer',
  'product_page',
  'pricing_page',
  'support_page',
] as const;

/**
 * Listed rather than derived from `Object.entries` only so the order is fixed:
 * "customers" first, because that is what most shops are configuring.
 */
const AUDIENCE_VALUES = ['customer', 'internal', 'both'] as const;

/** These five match the shared map exactly, so the option list is derived from it. */
const CONTEXT_MODE_OPTIONS = Object.entries(QUICK_ACTION_CONTEXT_LABELS);

/** Kinds of answer a form field can take. Used nowhere else, so it lives here. */
const FIELD_TYPES = [
  { value: 'text', label: 'Short text' },
  { value: 'email', label: 'Email address' },
  { value: 'tel', label: 'Phone number' },
  { value: 'date', label: 'A date' },
  { value: 'time', label: 'A time' },
  { value: 'textarea', label: 'Long text' },
];

type FieldRow = {
  id: string;
  name: string;
  label: string;
  type: string;
  required: boolean;
};

function cfgValue(action: QuickActionRow | undefined, key: string): string {
  const v = action?.config?.[key];
  return typeof v === 'string' ? v : '';
}

function parseFields(action: QuickActionRow | undefined, type: QuickActionType): FieldRow[] {
  if (action?.formSchema?.length) {
    return action.formSchema.map((field, index) => ({
      id: `${field.name}-${index}`,
      name: field.name,
      label: field.label,
      type: field.type,
      required: Boolean(field.required),
    }));
  }
  if (type === 'appointment_form') {
    return [
      { id: 'name', name: 'name', label: 'Name', type: 'text', required: true },
      { id: 'phone', name: 'phone', label: 'Phone', type: 'tel', required: true },
      { id: 'date', name: 'date', label: 'Preferred date', type: 'date', required: true },
      { id: 'time', name: 'time', label: 'Preferred time', type: 'time', required: false },
    ];
  }
  return [
    { id: 'name', name: 'name', label: 'Name', type: 'text', required: true },
    { id: 'email', name: 'email', label: 'Email', type: 'email', required: true },
    { id: 'phone', name: 'phone', label: 'Phone', type: 'tel', required: false },
  ];
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'field'
  );
}

function serializeFields(fields: FieldRow[]): string {
  return fields
    .filter((field) => field.label.trim())
    .map((field) => {
      const name = slug(field.name || field.label);
      return [name, field.label.trim(), field.type, field.required ? 'required' : '']
        .filter(Boolean)
        .join('|');
    })
    .join('\n');
}

export function QuickActionForm({
  bots,
  action,
  compact,
}: {
  bots: BotRow[];
  action?: QuickActionRow;
  compact?: boolean;
}) {
  const [state, formAction] = useFormState(saveQuickActionAction, initial);
  const [actionType, setActionType] = useState<QuickActionType>(
    action?.actionType ?? 'send_message',
  );
  const [label, setLabel] = useState(action?.label ?? '');
  const [description, setDescription] = useState(action?.description ?? '');
  const [messageText, setMessageText] = useState(cfgValue(action, 'message_text'));
  const [directAnswer, setDirectAnswer] = useState(cfgValue(action, 'direct_answer'));
  const [url, setUrl] = useState(cfgValue(action, 'url'));
  const [phone, setPhone] = useState(cfgValue(action, 'phone'));
  const [fields, setFields] = useState<FieldRow[]>(() =>
    parseFields(action, action?.actionType ?? 'send_message'),
  );
  const [contexts, setContexts] = useState<string[]>(
    action?.contexts?.length ? action.contexts : ['initial'],
  );
  const [pageUrlPatterns, setPageUrlPatterns] = useState(action?.pageUrlPatterns.join('\n') ?? '');
  const [keywordTriggers, setKeywordTriggers] = useState(action?.keywordTriggers.join(', ') ?? '');

  // The Chat buttons page renders this form once to create, and once more inside
  // every row's "Edit" panel. Ids therefore have to be scoped to the row, or a
  // page with three buttons ships four controls all called `label` and each
  // `<label for>` points at whichever one the browser found first.
  const fid = (name: string) => `qa-${action?.id ?? 'new'}-${name}`;

  const needsMessage = actionType === 'send_message' || actionType === 'request_human';
  const needsAnswer = actionType === 'direct_answer';
  const needsForm = actionType === 'lead_form' || actionType === 'appointment_form';
  const needsLink = actionType === 'external_link' || actionType === 'product_link';
  const needsPhone = actionType === 'whatsapp' || actionType === 'phone_call';

  const formSchema = useMemo(() => (needsForm ? serializeFields(fields) : ''), [fields, needsForm]);
  const previewLabel = label || 'Book appointment';
  // A saved row can hold a type this picker does not offer (`product_link`,
  // `tool_action`), so the preview icon needs a fallback rather than an index.
  const selectedOption = ACTION_OPTIONS.find((option) => option.value === actionType);
  const PreviewIcon = selectedOption?.icon ?? MessageSquare;

  function toggleContext(value: string) {
    setContexts((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    );
  }

  function addField() {
    const id = `field-${Date.now()}`;
    setFields((current) => [
      ...current,
      { id, name: '', label: '', type: 'text', required: false },
    ]);
  }

  function updateField(id: string, patch: Partial<FieldRow>) {
    setFields((current) =>
      current.map((field) =>
        field.id === id
          ? {
              ...field,
              ...patch,
              name: patch.label && !field.name ? slug(patch.label) : (patch.name ?? field.name),
            }
          : field,
      ),
    );
  }

  return (
    <form action={formAction} className="space-y-6">
      {action ? <input type="hidden" name="id" value={action.id} /> : null}
      <input type="hidden" name="actionType" value={actionType} />
      <input type="hidden" name="source" value={action?.source ?? 'manual'} />
      <input type="hidden" name="connectorDocumentId" value={action?.connectorDocumentId ?? ''} />
      <input type="hidden" name="connectorActionId" value={action?.connectorActionId ?? ''} />
      <input type="hidden" name="contexts" value={contexts.join(',')} />
      <input type="hidden" name="formSchema" value={formSchema} />
      <input type="hidden" name="customConfig" value="{}" />
      <input
        type="hidden"
        name="requiredCapabilities"
        value={action?.requiredCapabilities.join(',') ?? ''}
      />
      <input
        type="hidden"
        name="conversationStatuses"
        value={action?.conversationStatuses.join(',') ?? ''}
      />
      <input type="hidden" name="priority" value={action?.priority ?? 100} />

      <div className={cn('grid gap-6', compact ? '' : 'xl:grid-cols-[minmax(0,1fr)_360px]')}>
        <div className="space-y-6">
          <section className="rounded-lg border bg-card p-4">
            <div className="mb-4">
              <h3 className="font-semibold">1. What should this button do?</h3>
              <p className="text-sm text-muted-foreground">
                Pick what happens the moment a customer taps it.
              </p>
            </div>
            <div className={CHOICE_GRID}>
              {ACTION_OPTIONS.map((option) => {
                const Icon = option.icon;
                const active = actionType === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setActionType(option.value)}
                    aria-pressed={active}
                    className={cn(
                      // `bg-blue-50` for "selected" and `bg-white` for "not"
                      // are both undefined in dark mode — the whole picker was
                      // a grid of white cards on a dark page. `primary/10` is
                      // the same brand blue at the same weight, from the token,
                      // and it is the tint `CHOICE_CARD` uses everywhere else.
                      'rounded-lg border p-3 text-start transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                      active
                        ? 'border-primary bg-primary/10 shadow-sm'
                        : 'bg-card hover:border-primary/50 hover:bg-primary/5',
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={cn(
                          'rounded-md p-2',
                          active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                        )}
                      >
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <span>
                        <span className="block text-sm font-semibold">
                          {labelFor(QUICK_ACTION_TYPE_LABELS, option.value)}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {option.description}
                        </span>
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-lg border bg-card p-4">
            <div className="mb-4">
              <h3 className="font-semibold">2. What should visitors see?</h3>
              <p className="text-sm text-muted-foreground">
                The words on the button, and the content sitting behind it.
              </p>
            </div>
            <div className={FIELD_GRID}>
              <FormField label="Words on the button" htmlFor={fid('label')} required>
                <Input
                  id={fid('label')}
                  name="label"
                  required
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="Book appointment"
                />
              </FormField>
              <FormField
                label="Smaller line under it"
                htmlFor={fid('description')}
                hint="Optional. Use it when the button alone does not make the offer clear."
              >
                <Input
                  id={fid('description')}
                  name="description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Takes about a minute"
                />
              </FormField>
              <FormField
                label="Assistant"
                htmlFor={fid('botId')}
                hint="Leave this on “All assistants” and the button appears in every assistant you run. Pick one to show it in that assistant only."
              >
                <Select id={fid('botId')} name="botId" defaultValue={action?.botId ?? ''}>
                  <option value="">All assistants</option>
                  {bots.map((bot) => (
                    <option key={bot.id} value={bot.id}>
                      {bot.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Who sees it" htmlFor={fid('audience')}>
                <Select
                  id={fid('audience')}
                  name="audience"
                  defaultValue={action?.audience ?? 'customer'}
                >
                  {AUDIENCE_VALUES.map((value) => (
                    <option key={value} value={value}>
                      {labelFor(QUICK_ACTION_AUDIENCE_LABELS, value)}
                    </option>
                  ))}
                </Select>
              </FormField>
              {/* This used to be inert and the hint was worded to avoid
                  promising behaviour that did not happen. It is now honoured:
                  `src/lib/quick-actions.ts:205` filters every button through
                  `matchesBusinessHours` against `isOpenNow`, so the hint can
                  say plainly what the choice does. */}
              <FormField
                label="When to show it"
                htmlFor={fid('businessHoursMode')}
                hint="Checked against the opening hours saved in My business info. With no hours saved there is nothing to check, so the button shows at any time whichever option you pick."
              >
                <Select
                  id={fid('businessHoursMode')}
                  name="businessHoursMode"
                  defaultValue={action?.businessHoursMode ?? 'any'}
                >
                  <option value="any">Show it at any time</option>
                  <option value="during_hours">Only while you are open</option>
                  <option value="after_hours">Only once you have closed</option>
                </Select>
              </FormField>
            </div>

            <div className="mt-4 space-y-4">
              {needsMessage ? (
                <FormField
                  label={
                    actionType === 'request_human'
                      ? 'What the customer says when they ask for a person'
                      : 'The message the button sends'
                  }
                  htmlFor={fid('messageText')}
                  hint="This is typed into the chat for them, so write it in their words, not yours."
                >
                  <Input
                    id={fid('messageText')}
                    name="messageText"
                    value={messageText}
                    onChange={(event) => setMessageText(event.target.value)}
                    placeholder={
                      actionType === 'request_human'
                        ? 'I would like to speak to someone'
                        : 'I want to book an appointment'
                    }
                  />
                </FormField>
              ) : (
                <input type="hidden" name="messageText" value="" />
              )}

              {needsAnswer ? (
                <FormField
                  label="The answer they will see"
                  htmlFor={fid('directAnswer')}
                  hint="Shown exactly as you write it. The assistant does not reword it."
                >
                  <Textarea
                    id={fid('directAnswer')}
                    name="directAnswer"
                    value={directAnswer}
                    onChange={(event) => setDirectAnswer(event.target.value)}
                    rows={5}
                    placeholder="We are open 9am to 6pm, Monday to Saturday."
                  />
                </FormField>
              ) : (
                <input type="hidden" name="directAnswer" value="" />
              )}

              {needsLink ? (
                <FormField
                  label={
                    actionType === 'product_link'
                      ? 'Web address of the product'
                      : 'Web address the button opens'
                  }
                  htmlFor={fid('url')}
                >
                  <Input
                    id={fid('url')}
                    name="url"
                    type="url"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="https://example.com/pricing"
                  />
                </FormField>
              ) : (
                <input type="hidden" name="url" value="" />
              )}

              {needsPhone ? (
                <FormField
                  label={
                    actionType === 'whatsapp' ? 'Your WhatsApp number' : 'The number they will ring'
                  }
                  htmlFor={fid('phone')}
                  hint="Include the country code, so it works for customers dialling from anywhere."
                >
                  <Input
                    id={fid('phone')}
                    name="phone"
                    type="tel"
                    inputMode="tel"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    placeholder="+447432391811"
                  />
                </FormField>
              ) : (
                <input type="hidden" name="phone" value="" />
              )}
            </div>
          </section>

          {needsForm ? (
            <section className="rounded-lg border bg-card p-4">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">3. What should it ask them?</h3>
                  <p className="text-sm text-muted-foreground">
                    One question per row. Nothing technical — write them the way you would ask in
                    person.
                  </p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={addField}>
                  <Plus className="me-2 h-4 w-4" aria-hidden="true" /> Add a question
                </Button>
              </div>
              <div className="space-y-3">
                {fields.map((field, index) => (
                  // These inputs deliberately carry no `name`: the rows are
                  // serialised into the hidden `formSchema` field above, so a
                  // name here would only post a duplicate stray value.
                  <div
                    key={field.id}
                    className="grid gap-3 rounded-md border p-3 md:grid-cols-[1fr_170px_auto_auto] md:items-end"
                  >
                    <FormField
                      label={`Question ${index + 1}`}
                      htmlFor={fid(`field-${field.id}-label`)}
                    >
                      <Input
                        id={fid(`field-${field.id}-label`)}
                        value={field.label}
                        onChange={(event) => updateField(field.id, { label: event.target.value })}
                        placeholder="What is your name?"
                      />
                    </FormField>
                    <FormField label="Kind of answer" htmlFor={fid(`field-${field.id}-type`)}>
                      <Select
                        id={fid(`field-${field.id}-type`)}
                        value={field.type}
                        onChange={(event) => updateField(field.id, { type: event.target.value })}
                      >
                        {FIELD_TYPES.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    </FormField>
                    <label className="flex items-center gap-2 pb-2 text-sm">
                      <input
                        type="checkbox"
                        checked={field.required}
                        onChange={(event) =>
                          updateField(field.id, { required: event.target.checked })
                        }
                        className="h-4 w-4"
                      />
                      They must answer
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="mb-1"
                      aria-label={`Remove question ${index + 1}${field.label ? `: ${field.label}` : ''}`}
                      onClick={() =>
                        setFields((current) => current.filter((item) => item.id !== field.id))
                      }
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="rounded-lg border bg-card p-4">
            <div className="mb-4">
              <h3 className="font-semibold">{needsForm ? '4' : '3'}. When should it appear?</h3>
              <p className="text-sm text-muted-foreground">
                Tick every moment this button makes sense. Everything below that is optional.
              </p>
            </div>
            {/* `sm:grid-cols-2 lg:grid-cols-3` inside a card that itself sits in
                the 1fr side of an `xl:` split — so on a 1280px screen this was
                three columns of about 110px holding phrases like "After the
                first reply". `CHOICE_GRID` measures the card. */}
            <div className={CHOICE_GRID}>
              {CONTEXT_VALUES.map((value) => (
                <label key={value} className={CHOICE_CARD}>
                  <input
                    type="checkbox"
                    checked={contexts.includes(value)}
                    onChange={() => toggleContext(value)}
                    className={CHECKBOX}
                  />
                  <span>{labelFor(QUICK_ACTION_MOMENT_LABELS, value)}</span>
                </label>
              ))}
            </div>
            <div className={cn(FIELD_GRID, 'mt-4')}>
              <FormField
                label="Words that bring it up"
                htmlFor={fid('keywordTriggers')}
                hint="Separate them with commas. When a customer types one of these, the assistant offers this button."
              >
                <Input
                  id={fid('keywordTriggers')}
                  name="keywordTriggers"
                  value={keywordTriggers}
                  onChange={(event) => setKeywordTriggers(event.target.value)}
                  placeholder="price, booking, demo"
                />
              </FormField>
              <FormField
                label="Which kind of moment is this"
                htmlFor={fid('contextMode')}
                hint="The boxes above decide which moments the button is allowed in. This says what sort of button it is when it gets there — a starter that greets people, one the assistant slips in when it fits what they just said, one that follows an answer, or one for someone hunting a page or ready to act."
              >
                <Select
                  id={fid('contextMode')}
                  name="contextMode"
                  defaultValue={action?.contextMode ?? 'initial'}
                >
                  {CONTEXT_MODE_OPTIONS.map(([value, text]) => (
                    <option key={value} value={value}>
                      {text}
                    </option>
                  ))}
                </Select>
              </FormField>
              <label className="flex items-center gap-2 pt-7 text-sm">
                <input
                  type="checkbox"
                  name="isActive"
                  defaultChecked={action?.isActive ?? true}
                  className="h-4 w-4"
                />
                Show this button in the chat
              </label>
            </div>
            <details className="mt-4 rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                Only show it on certain pages
              </summary>
              <div className="mt-4">
                <FormField
                  label="Show only on these pages"
                  htmlFor={fid('pageUrlPatterns')}
                  hint="One web address, or part of one, per line — “/pricing” matches every page whose address contains it. Leave this empty and the button shows on every page."
                >
                  <Textarea
                    id={fid('pageUrlPatterns')}
                    name="pageUrlPatterns"
                    value={pageUrlPatterns}
                    onChange={(event) => setPageUrlPatterns(event.target.value)}
                    rows={3}
                    placeholder={'/pricing\n/products'}
                  />
                </FormField>
              </div>
            </details>
          </section>
        </div>

        {compact ? null : (
          <aside className="space-y-4">
            {/* DELIBERATELY FIXED-LIGHT, like the sidebar gradient: everything
                from here to the end of this panel is a PICTURE of the widget as
                a visitor sees it on the shop's own website, not dashboard
                chrome. It must not follow the dashboard's dark theme, because
                the thing it depicts does not. The panel's own frame and border
                are token-backed; only the mock inside is fixed. */}
            <div className="rounded-xl border bg-slate-950 p-4 text-white shadow-xl">
              <div className="mb-4 flex items-center gap-2">
                <Bot className="h-5 w-5 text-emerald-300" aria-hidden="true" />
                <div>
                  <div className="text-sm font-semibold">How it will look</div>
                  <div className="text-xs text-slate-400">Your button, in your website chat</div>
                </div>
              </div>
              <div className="rounded-xl bg-white p-3 text-slate-950">
                <div className="mb-3 text-sm text-slate-600">Hi! How can I help?</div>
                <button
                  type="button"
                  className="inline-flex max-w-full items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white shadow"
                >
                  <PreviewIcon className="h-4 w-4" aria-hidden="true" />
                  <span className="truncate">{previewLabel}</span>
                </button>
                {description ? (
                  <div className="mt-2 text-xs text-slate-500">{description}</div>
                ) : null}
              </div>
            </div>

            {/* `bg-blue-50` + `text-blue-950` is the informational tone written
                out by hand, and it collided with the brand blue that means
                "selected" three sections above it. `--info` is deliberately
                cyan for exactly this reason (see the UI README). */}
            <div className="rounded-lg border border-info-border bg-info-bg p-4 text-info-fg">
              <div className="mb-2 text-sm font-semibold">An example</div>
              <button
                type="button"
                disabled
                className="inline-flex cursor-not-allowed items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-500 shadow-sm"
              >
                <CalendarDays className="h-4 w-4" aria-hidden="true" />
                Book a free demo
              </button>
              <p className="mt-3 text-xs opacity-80">
                This one does nothing — it is here to show you the shape a real chat button takes.
              </p>
            </div>

            <div className="rounded-lg border bg-card p-4 text-sm">
              <div className="font-semibold">What you have set so far</div>
              <div className="mt-3 space-y-2 text-muted-foreground">
                <div>
                  <span className="font-medium text-foreground">It will:</span>{' '}
                  {labelFor(QUICK_ACTION_TYPE_LABELS, actionType)}
                </div>
                <div>
                  <span className="font-medium text-foreground">Appears:</span>{' '}
                  {contexts.length
                    ? contexts.map((c) => labelFor(QUICK_ACTION_MOMENT_LABELS, c)).join(', ')
                    : 'No moment ticked yet'}
                </div>
                {needsForm ? (
                  <div>
                    <span className="font-medium text-foreground">Questions it asks:</span>{' '}
                    {fields.length}
                  </div>
                ) : null}
              </div>
            </div>
          </aside>
        )}
      </div>

      <input type="hidden" name="startsNewMessage" value="on" />

      {/* Replaces a hand-rolled pair of <p>s: this one is a live region, so the
          save result is actually announced instead of silently appearing. */}
      <FormMessage state={state} okText="Saved." />
      <div className="flex justify-end">
        <SubmitButton className="min-w-40" pendingLabel="Saving…">
          {action ? 'Save this chat button' : 'Create this chat button'}
        </SubmitButton>
      </div>
    </form>
  );
}
