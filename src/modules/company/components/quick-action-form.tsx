'use client';

import { useMemo, useState, type ComponentType } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Bot, CalendarDays, ExternalLink, FileText, HelpCircle, MessageSquare, Phone, Plus, Trash2, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { QuickActionType } from '@/lib/quick-actions';
import type { BotRow } from '../data';
import { saveQuickActionAction, type QuickActionState } from '../quick-actions-actions';
import type { QuickActionRow } from '../quick-actions-data';

const initial: QuickActionState = {};
const selectCls =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const ACTION_OPTIONS: Array<{
  value: QuickActionType;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  { value: 'send_message', label: 'Send message', description: 'Starts a chat with a prepared message.', icon: MessageSquare },
  { value: 'direct_answer', label: 'Direct answer', description: 'Shows a saved answer instantly.', icon: FileText },
  { value: 'lead_form', label: 'Lead form', description: 'Collects contact details from visitors.', icon: UserRound },
  { value: 'appointment_form', label: 'Appointment form', description: 'Collects booking details.', icon: CalendarDays },
  { value: 'external_link', label: 'Open link', description: 'Sends visitors to a page or product.', icon: ExternalLink },
  { value: 'whatsapp', label: 'WhatsApp', description: 'Opens WhatsApp with your number.', icon: Phone },
  { value: 'phone_call', label: 'Phone call', description: 'Lets mobile visitors call quickly.', icon: Phone },
  { value: 'request_human', label: 'Human agent', description: 'Asks a team member to take over.', icon: HelpCircle },
];

const CONTEXT_OPTIONS = [
  { value: 'initial', label: 'Start of chat' },
  { value: 'after_answer', label: 'After AI answer' },
  { value: 'product_page', label: 'Product pages' },
  { value: 'pricing_page', label: 'Pricing pages' },
  { value: 'support_page', label: 'Support pages' },
];

const FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'email', label: 'Email' },
  { value: 'tel', label: 'Phone' },
  { value: 'date', label: 'Date' },
  { value: 'time', label: 'Time' },
  { value: 'textarea', label: 'Long text' },
];

type FieldRow = {
  id: string;
  name: string;
  label: string;
  type: string;
  required: boolean;
};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="min-w-40">
      {pending ? 'Saving...' : label}
    </Button>
  );
}

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
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'field';
}

function serializeFields(fields: FieldRow[]): string {
  return fields
    .filter((field) => field.label.trim())
    .map((field) => {
      const name = slug(field.name || field.label);
      return [name, field.label.trim(), field.type, field.required ? 'required' : ''].filter(Boolean).join('|');
    })
    .join('\n');
}

function actionLabel(type: QuickActionType): string {
  return ACTION_OPTIONS.find((option) => option.value === type)?.label ?? type.replace(/_/g, ' ');
}

export function QuickActionForm({ bots, action, compact }: { bots: BotRow[]; action?: QuickActionRow; compact?: boolean }) {
  const [state, formAction] = useFormState(saveQuickActionAction, initial);
  const [actionType, setActionType] = useState<QuickActionType>(action?.actionType ?? 'send_message');
  const [label, setLabel] = useState(action?.label ?? '');
  const [description, setDescription] = useState(action?.description ?? '');
  const [messageText, setMessageText] = useState(cfgValue(action, 'message_text'));
  const [directAnswer, setDirectAnswer] = useState(cfgValue(action, 'direct_answer'));
  const [url, setUrl] = useState(cfgValue(action, 'url'));
  const [phone, setPhone] = useState(cfgValue(action, 'phone'));
  const [fields, setFields] = useState<FieldRow[]>(() => parseFields(action, action?.actionType ?? 'send_message'));
  const [contexts, setContexts] = useState<string[]>(action?.contexts?.length ? action.contexts : ['initial']);
  const [pageUrlPatterns, setPageUrlPatterns] = useState(action?.pageUrlPatterns.join('\n') ?? '');
  const [keywordTriggers, setKeywordTriggers] = useState(action?.keywordTriggers.join(', ') ?? '');

  const needsMessage = actionType === 'send_message' || actionType === 'request_human';
  const needsAnswer = actionType === 'direct_answer';
  const needsForm = actionType === 'lead_form' || actionType === 'appointment_form';
  const needsLink = actionType === 'external_link' || actionType === 'product_link';
  const needsPhone = actionType === 'whatsapp' || actionType === 'phone_call';

  const formSchema = useMemo(() => (needsForm ? serializeFields(fields) : ''), [fields, needsForm]);
  const previewLabel = label || 'Book appointment';
  const selectedOption = ACTION_OPTIONS.find((option) => option.value === actionType) ?? {
    value: 'send_message',
    label: 'Send message',
    description: 'Starts a chat with a prepared message.',
    icon: MessageSquare,
  };
  const PreviewIcon = selectedOption.icon;

  function toggleContext(value: string) {
    setContexts((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    );
  }

  function addField() {
    const id = `field-${Date.now()}`;
    setFields((current) => [...current, { id, name: '', label: '', type: 'text', required: false }]);
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
      <input type="hidden" name="contexts" value={contexts.join(',')} />
      <input type="hidden" name="formSchema" value={formSchema} />
      <input type="hidden" name="customConfig" value="{}" />
      <input type="hidden" name="requiredCapabilities" value={action?.requiredCapabilities.join(',') ?? ''} />
      <input type="hidden" name="conversationStatuses" value={action?.conversationStatuses.join(',') ?? ''} />
      <input type="hidden" name="priority" value={action?.priority ?? 100} />

      <div className={cn('grid gap-6', compact ? '' : 'xl:grid-cols-[minmax(0,1fr)_360px]')}>
        <div className="space-y-6">
          <section className="rounded-lg border bg-white p-4">
            <div className="mb-4">
              <h3 className="font-semibold">1. What should this pill do?</h3>
              <p className="text-sm text-muted-foreground">Choose the action visitors trigger from the chat widget.</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {ACTION_OPTIONS.map((option) => {
                const Icon = option.icon;
                const active = actionType === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setActionType(option.value)}
                    className={cn(
                      'rounded-lg border p-3 text-left transition hover:border-primary/50 hover:bg-blue-50/40',
                      active ? 'border-primary bg-blue-50 shadow-sm' : 'bg-white',
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <span className={cn('rounded-md p-2', active ? 'bg-primary text-white' : 'bg-muted text-muted-foreground')}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <span>
                        <span className="block text-sm font-semibold">{option.label}</span>
                        <span className="block text-xs text-muted-foreground">{option.description}</span>
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-lg border bg-white p-4">
            <div className="mb-4">
              <h3 className="font-semibold">2. What should visitors see?</h3>
              <p className="text-sm text-muted-foreground">This controls the pill label and the content behind it.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Button label</Label>
                <Input name="label" required value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Book appointment" />
              </div>
              <div className="space-y-1.5">
                <Label>Small helper text</Label>
                <Input name="description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional, shown under the pill" />
              </div>
              <div className="space-y-1.5">
                <Label>Assistant</Label>
                <select name="botId" className={selectCls} defaultValue={action?.botId ?? ''}>
                  <option value="">All assistants</option>
                  {bots.map((bot) => (
                    <option key={bot.id} value={bot.id}>
                      {bot.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Business hours</Label>
                <select name="businessHoursMode" className={selectCls} defaultValue={action?.businessHoursMode ?? 'any'}>
                  <option value="any">Show any time</option>
                  <option value="during_hours">Only during business hours</option>
                  <option value="after_hours">Only after hours</option>
                </select>
              </div>
            </div>

            <div className="mt-4 space-y-4">
              {needsMessage ? (
                <div className="space-y-1.5">
                  <Label>{actionType === 'request_human' ? 'Handoff message' : 'Message sent to chat'}</Label>
                  <Input
                    name="messageText"
                    value={messageText}
                    onChange={(event) => setMessageText(event.target.value)}
                    placeholder={actionType === 'request_human' ? 'I want to speak to a human agent' : 'I want to book an appointment'}
                  />
                </div>
              ) : (
                <input type="hidden" name="messageText" value="" />
              )}

              {needsAnswer ? (
                <div className="space-y-1.5">
                  <Label>Answer visitors will see</Label>
                  <Textarea name="directAnswer" value={directAnswer} onChange={(event) => setDirectAnswer(event.target.value)} rows={5} placeholder="Write the exact answer the assistant should show." />
                </div>
              ) : (
                <input type="hidden" name="directAnswer" value="" />
              )}

              {needsLink ? (
                <div className="space-y-1.5">
                  <Label>{actionType === 'product_link' ? 'Product URL' : 'Page URL'}</Label>
                  <Input name="url" type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/pricing" />
                </div>
              ) : (
                <input type="hidden" name="url" value="" />
              )}

              {needsPhone ? (
                <div className="space-y-1.5">
                  <Label>{actionType === 'whatsapp' ? 'WhatsApp number' : 'Phone number'}</Label>
                  <Input name="phone" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+447432391811" />
                </div>
              ) : (
                <input type="hidden" name="phone" value="" />
              )}
            </div>
          </section>

          {needsForm ? (
            <section className="rounded-lg border bg-white p-4">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">3. Form fields</h3>
                  <p className="text-sm text-muted-foreground">Add the details visitors should provide. No code or pipe syntax needed.</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={addField}>
                  <Plus className="mr-2 h-4 w-4" /> Add field
                </Button>
              </div>
              <div className="space-y-3">
                {fields.map((field) => (
                  <div key={field.id} className="grid gap-3 rounded-md border p-3 md:grid-cols-[1fr_150px_auto_auto]">
                    <Input value={field.label} onChange={(event) => updateField(field.id, { label: event.target.value })} placeholder="Field label" />
                    <select className={selectCls} value={field.type} onChange={(event) => updateField(field.id, { type: event.target.value })}>
                      {FIELD_TYPES.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={field.required} onChange={(event) => updateField(field.id, { required: event.target.checked })} className="h-4 w-4" />
                      Required
                    </label>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setFields((current) => current.filter((item) => item.id !== field.id))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="rounded-lg border bg-white p-4">
            <div className="mb-4">
              <h3 className="font-semibold">{needsForm ? '4' : '3'}. When should it appear?</h3>
              <p className="text-sm text-muted-foreground">Choose common moments. Advanced page targeting is optional.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {CONTEXT_OPTIONS.map((option) => (
                <label key={option.value} className="flex items-center gap-2 rounded-md border p-3 text-sm">
                  <input type="checkbox" checked={contexts.includes(option.value)} onChange={() => toggleContext(option.value)} className="h-4 w-4" />
                  {option.label}
                </label>
              ))}
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Keyword triggers</Label>
                <Input name="keywordTriggers" value={keywordTriggers} onChange={(event) => setKeywordTriggers(event.target.value)} placeholder="price, booking, demo" />
              </div>
              <label className="flex items-center gap-2 pt-7 text-sm">
                <input type="checkbox" name="isActive" defaultChecked={action?.isActive ?? true} className="h-4 w-4" />
                Active
              </label>
            </div>
            <details className="mt-4 rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">Advanced page targeting</summary>
              <div className="mt-4 space-y-1.5">
                <Label>Show only on these pages</Label>
                <Textarea name="pageUrlPatterns" value={pageUrlPatterns} onChange={(event) => setPageUrlPatterns(event.target.value)} rows={3} placeholder={"/pricing\n/products"} />
              </div>
            </details>
          </section>
        </div>

        {compact ? null : (
        <aside className="space-y-4">
          <div className="rounded-xl border bg-slate-950 p-4 text-white shadow-xl">
            <div className="mb-4 flex items-center gap-2">
              <Bot className="h-5 w-5 text-emerald-300" />
              <div>
                <div className="text-sm font-semibold">Widget preview</div>
                <div className="text-xs text-slate-400">How visitors understand this pill</div>
              </div>
            </div>
            <div className="rounded-xl bg-white p-3 text-slate-950">
              <div className="mb-3 text-sm text-slate-600">Hi! How can I help?</div>
              <button type="button" className="inline-flex max-w-full items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white shadow">
                <PreviewIcon className="h-4 w-4" />
                <span className="truncate">{previewLabel}</span>
              </button>
              {description ? <div className="mt-2 text-xs text-slate-500">{description}</div> : null}
            </div>
          </div>

          <div className="rounded-xl border bg-blue-50 p-4">
            <div className="mb-2 text-sm font-semibold text-blue-950">Demo pill</div>
            <button type="button" disabled className="inline-flex cursor-not-allowed items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-500 shadow-sm">
              <CalendarDays className="h-4 w-4" />
              Book a free demo
            </button>
            <p className="mt-3 text-xs text-blue-900/70">
              Example only. It is disabled, but shows how a real quick action will appear in the chat widget.
            </p>
          </div>

          <div className="rounded-xl border bg-white p-4 text-sm">
            <div className="font-semibold">Current setup</div>
            <div className="mt-3 space-y-2 text-muted-foreground">
              <div><span className="font-medium text-foreground">Type:</span> {actionLabel(actionType)}</div>
              <div><span className="font-medium text-foreground">Shown:</span> {contexts.length ? contexts.map((c) => CONTEXT_OPTIONS.find((o) => o.value === c)?.label ?? c).join(', ') : 'Not selected'}</div>
              {needsForm ? <div><span className="font-medium text-foreground">Fields:</span> {fields.length}</div> : null}
            </div>
          </div>
        </aside>
        )}
      </div>

      <input type="hidden" name="startsNewMessage" value="on" />

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-emerald-600">Saved.</p> : null}
      <div className="flex justify-end">
        <SubmitButton label={action ? 'Save quick action' : 'Create quick action'} />
      </div>
    </form>
  );
}
