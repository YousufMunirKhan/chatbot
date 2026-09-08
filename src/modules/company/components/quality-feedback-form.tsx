'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useFormState } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { companyLabel } from '@/lib/labels';
import { saveQualityFeedbackAction, type QualityActionState } from '../quality-actions';

const initial: QualityActionState = {};

const FIX_TYPES = [
  {
    value: 'knowledge',
    label: 'Add missing answer',
    helper: 'Saves a general knowledge fix in the Knowledge Base.',
  },
  {
    value: 'faq',
    label: 'Add FAQ-style answer',
    helper: 'Creates an editable FAQ and indexes the answer.',
  },
  {
    value: 'policy',
    label: 'Add policy or rule',
    helper: 'Use for refunds, delivery, warranty, pricing rules.',
  },
  {
    value: 'service',
    label: 'Update service or offer',
    helper: 'Use for prices, booking rules, products, packages.',
  },
  {
    value: 'profile',
    label: 'Update business details',
    helper: 'Use for hours, contact, location, service areas.',
  },
  {
    value: 'prompt',
    label: 'Improve assistant instruction',
    helper: 'Use for tone, behavior, or escalation style.',
  },
];

export function QualityFeedbackForm({ qualityLogId }: { qualityLogId: string }) {
  const [state, action] = useFormState(saveQualityFeedbackAction, initial);
  const [fixType, setFixType] = useState('knowledge');
  const selected = FIX_TYPES.find((type) => type.value === fixType) ?? FIX_TYPES[0];

  return (
    // The panel tint was `bg-blue-50/40`. Read as *informational* — it marks the
    // "here is how you fix it" workspace, not a selected row — so it takes
    // `--info` (cyan) rather than the brand blue that `quick-action-form` uses
    // for selection.
    <form action={action} className="space-y-4 rounded-lg border bg-info-bg/40 p-4">
      <input type="hidden" name="qualityLogId" value={qualityLogId} />
      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <FormField label="What kind of fix?" htmlFor="fixType" hint={selected?.helper}>
          <Select
            name="fixType"
            value={fixType}
            onChange={(event) => setFixType(event.target.value)}
          >
            {FIX_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="What should the assistant know next time?" htmlFor="correctionText">
          <Textarea
            name="correctionText"
            rows={4}
            placeholder="Write the correct answer, business rule, or detail. The customer question is only context; this answer is what gets saved."
          />
        </FormField>
      </div>
      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <FormField label="Issue type" htmlFor="rating">
          <Select name="rating" defaultValue="missing_info">
            <option value="missing_info">Missing information</option>
            <option value="wrong_answer">Wrong answer</option>
            <option value="bad">Poor answer</option>
            <option value="too_slow">Too slow</option>
            {/* "Needs human" was the stored token with the underscore taken
                out. `conversationStatus` already owns the company-audience
                wording for this exact value, so the option and the conversation
                badge cannot drift apart. */}
            <option value="needs_human">{companyLabel('conversationStatus', 'needs_human')}</option>
            <option value="good">Actually okay</option>
          </Select>
        </FormField>
        <div className="flex flex-wrap items-center gap-3 self-end">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" name="createKnowledge" defaultChecked className="h-4 w-4" />
            Create the editable fix and index it for AI search
          </label>
          <SubmitButton size="sm" pendingLabel="Saving…">
            Save fix and index
          </SubmitButton>
          {fixType !== 'knowledge' && fixType !== 'faq' ? (
            <Button asChild variant="outline" size="sm">
              <Link
                href={fixType === 'prompt' ? '/company/bots' : '/company/business-data?tab=basics'}
              >
                Open full editor
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
      <FormMessage
        state={state}
        okText="Saved and indexed. The assistant can now retrieve this correction from AI search."
      />
    </form>
  );
}
