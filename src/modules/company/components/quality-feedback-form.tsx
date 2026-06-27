'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { saveQualityFeedbackAction, type QualityActionState } from '../quality-actions';

const initial: QualityActionState = {};
const selectCls =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const FIX_TYPES = [
  { value: 'knowledge', label: 'Add missing answer', helper: 'Saves a general knowledge fix in the Knowledge Base.' },
  { value: 'faq', label: 'Add FAQ-style answer', helper: 'Creates an editable FAQ and indexes the answer.' },
  { value: 'policy', label: 'Add policy or rule', helper: 'Use for refunds, delivery, warranty, pricing rules.' },
  { value: 'service', label: 'Update service or offer', helper: 'Use for prices, booking rules, products, packages.' },
  { value: 'profile', label: 'Update business details', helper: 'Use for hours, contact, location, service areas.' },
  { value: 'prompt', label: 'Improve assistant instruction', helper: 'Use for tone, behavior, or escalation style.' },
];

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Saving...' : 'Save fix and index'}
    </Button>
  );
}

export function QualityFeedbackForm({ qualityLogId }: { qualityLogId: string }) {
  const [state, action] = useFormState(saveQualityFeedbackAction, initial);
  const [fixType, setFixType] = useState('knowledge');
  const selected = FIX_TYPES.find((type) => type.value === fixType) ?? FIX_TYPES[0];

  return (
    <form action={action} className="space-y-4 rounded-lg border bg-blue-50/40 p-4">
      <input type="hidden" name="qualityLogId" value={qualityLogId} />
      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <div className="space-y-1.5">
          <Label>What kind of fix?</Label>
          <select name="fixType" className={selectCls} value={fixType} onChange={(event) => setFixType(event.target.value)}>
            {FIX_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">{selected?.helper}</p>
        </div>
        <div className="space-y-1.5">
          <Label>What should the assistant know next time?</Label>
          <Textarea
            name="correctionText"
            rows={4}
            placeholder="Write the correct answer, business rule, or detail. The customer question is only context; this answer is what gets saved."
          />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <div className="space-y-1.5">
          <Label>Issue type</Label>
          <select name="rating" className={selectCls} defaultValue="missing_info">
            <option value="missing_info">Missing information</option>
            <option value="wrong_answer">Wrong answer</option>
            <option value="bad">Poor answer</option>
            <option value="too_slow">Too slow</option>
            <option value="needs_human">Needs human</option>
            <option value="good">Actually okay</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-3 self-end">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" name="createKnowledge" defaultChecked className="h-4 w-4" />
            Create the editable fix and index it for AI search
          </label>
          <Submit />
          {fixType !== 'knowledge' && fixType !== 'faq' ? (
            <Button asChild variant="outline" size="sm">
              <Link href={fixType === 'prompt' ? '/company/bots' : '/company/profile'}>Open full editor</Link>
            </Button>
          ) : null}
        </div>
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.ok ? (
        <p className="text-sm text-emerald-700">
          Saved and indexed. The assistant can now retrieve this correction from AI search.
        </p>
      ) : null}
    </form>
  );
}
