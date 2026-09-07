'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormState } from 'react-dom';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { LEAD_STATUS_LABELS, labelFor } from '@/lib/constants';
import { createBroadcastAction, type ActionState } from '../broadcasts-actions';

const initial: ActionState = {};

/**
 * The stages in the order an enquiry moves through them.
 *
 * The wording comes from `LEAD_STATUS_LABELS`; only the running order lives
 * here, because a `Record` carries no meaningful order and the picker should
 * read as a funnel rather than alphabetically.
 */
const LEAD_STATUS_ORDER = ['new', 'contacted', 'qualified', 'converted', 'closed'] as const;

type Audience = 'all_leads' | 'opted_in' | 'tag' | 'segment' | 'custom';

export interface BroadcastFormProps {
  /** Approved WhatsApp templates — the only ones Meta accepts for outreach. */
  templates?: Array<{ name: string; language: string }>;
}

export function BroadcastForm({ templates = [] }: BroadcastFormProps) {
  const [state, action] = useFormState(createBroadcastAction, initial);
  const [channel, setChannel] = useState<'whatsapp' | 'email'>('whatsapp');
  const [audience, setAudience] = useState<Audience>('all_leads');
  const [templateName, setTemplateName] = useState('');
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) {
      ref.current?.reset();
      setTemplateName('');
    }
  }, [state.ok]);

  // The scheduler stores UTC; recording the composer's zone makes "9am" in the
  // list mean what the person who scheduled it meant.
  const timezone =
    typeof Intl === 'undefined' ? '' : Intl.DateTimeFormat().resolvedOptions().timeZone;
  const selected = templates.find((t) => t.name === templateName);

  return (
    <form ref={ref} action={action} className="space-y-4">
      <input type="hidden" name="scheduledTimezone" value={timezone} />

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Channel" htmlFor="channel">
          {/* This select was one of two that hand-rolled their classes inline with
              a bare `border` and no focus ring; `Select` gives it `border-input`
              and the standard ring. */}
          <Select
            name="channel"
            value={channel}
            onChange={(e) => setChannel(e.target.value as typeof channel)}
          >
            <option value="whatsapp">WhatsApp</option>
            <option value="email">Email</option>
          </Select>
        </FormField>

        <FormField
          label="Audience"
          htmlFor="audience"
          hint="Anyone who opted out is skipped, whichever audience you pick."
        >
          <Select
            name="audience"
            value={audience}
            onChange={(e) => setAudience(e.target.value as Audience)}
          >
            <option value="all_leads">All leads</option>
            <option value="opted_in">Opted-in contacts only</option>
            <option value="tag">By conversation tag</option>
            <option value="segment">By lead status</option>
            <option value="custom">A list I paste in</option>
          </Select>
        </FormField>
      </div>

      {audience === 'tag' ? (
        <FormField label="Conversation tag" htmlFor="audienceTag">
          <Input name="audienceTag" maxLength={60} placeholder="vip" />
        </FormField>
      ) : null}

      {audience === 'segment' ? (
        <FormField label="Lead status" htmlFor="audienceStatus">
          {/* Driven from LEAD_STATUS_LABELS rather than hard-coded: these five
              values were spelled "New"/"Qualified" here and "New enquiry"/"Worth
              pursuing" on the Leads screen, so the same stored status read as two
              different things depending on which page you were on. The submitted
              values are the map's keys, so nothing about the request changes. */}
          <Select name="audienceStatus" defaultValue="qualified">
            {LEAD_STATUS_ORDER.map((status) => (
              <option key={status} value={status}>
                {labelFor(LEAD_STATUS_LABELS, status)}
              </option>
            ))}
          </Select>
        </FormField>
      ) : null}

      {audience === 'custom' ? (
        <FormField
          label="Contacts"
          htmlFor="audienceContacts"
          hint="One per line, or comma separated. Phone numbers in +country format."
        >
          <Textarea name="audienceContacts" rows={3} placeholder={'+971500000000\n+971500000001'} />
        </FormField>
      ) : null}

      {channel === 'email' ? (
        <FormField label="Subject" htmlFor="subject">
          <Input name="subject" maxLength={200} />
        </FormField>
      ) : null}

      {channel === 'whatsapp' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="Template"
            htmlFor="templateName"
            hint="Required to reach anyone who has not messaged you in the last 24 hours."
          >
            <Select
              name="templateName"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
            >
              <option value="">No template (session message only)</option>
              {templates.map((t) => (
                <option key={`${t.name}:${t.language}`} value={t.name}>
                  {t.name} ({t.language})
                </option>
              ))}
            </Select>
          </FormField>

          {templateName ? (
            <FormField
              label="Template values"
              htmlFor="templateVariables"
              hint="Fills {{1}}, {{2}}… in order. Separate with a | character."
            >
              <Input name="templateVariables" placeholder="Sara|ORD-1042" />
            </FormField>
          ) : null}
          {templateName ? (
            <input type="hidden" name="templateLanguage" value={selected?.language ?? 'en_US'} />
          ) : null}
        </div>
      ) : null}

      <FormField
        label="Message"
        htmlFor="message"
        hint={
          channel === 'whatsapp' && templateName
            ? 'Kept as the fallback text for contacts still inside the 24h window.'
            : undefined
        }
      >
        <Textarea name="message" required rows={3} maxLength={2000} />
      </FormField>

      <FormField label="Send at (optional — leave blank to send on next run)" htmlFor="scheduleAt">
        <Input name="scheduleAt" type="datetime-local" />
      </FormField>

      <FormMessage state={state} okText="Broadcast scheduled." />
      <SubmitButton pendingLabel="Scheduling…">Schedule broadcast</SubmitButton>
    </form>
  );
}
