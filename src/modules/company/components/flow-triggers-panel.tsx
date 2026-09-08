'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { deleteFlowTriggerAction, saveFlowTriggerAction } from '../flows-actions';
import { ConfirmButton } from './confirm-button';
import { describeTrigger, TRIGGER_TYPE_LABELS, type TriggerLike } from '../flow-graph';
import type { FlowTriggerRow, MatchMode, TriggerType } from '../flows-data';

/**
 * "When does this flow run?"
 *
 * The trigger types map one-to-one onto `flow_triggers.type`. Each one shows
 * only the fields it actually uses, and every row carries the plain-English
 * sentence from `describeTrigger` so nobody has to translate
 * "keyword / starts_with / hi" in their head.
 */

const CHANNEL_CHOICES = [
  'web_chat',
  'whatsapp',
  'instagram',
  'facebook',
  'telegram',
  'email',
] as const;

const VALUE_LABEL: Record<TriggerType, string> = {
  keyword: 'Keyword or phrase',
  referral: 'Ref parameter (m.me/you?ref=…)',
  ad: 'Facebook ad id',
  comment: 'Comment contains',
  intent: 'Intent',
  welcome: '',
  event: 'Event name',
};

interface Draft {
  id?: string;
  type: TriggerType;
  matchValue: string;
  matchMode: MatchMode;
  channels: string[];
  isActive: boolean;
}

const emptyDraft: Draft = {
  type: 'keyword',
  matchValue: '',
  matchMode: 'contains',
  channels: [],
  isActive: true,
};

export function FlowTriggersPanel({
  flowId,
  triggers,
  intents,
}: {
  flowId: string;
  triggers: FlowTriggerRow[];
  intents: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const editing = Boolean(draft.id);
  const needsMatchMode = draft.type === 'keyword' || draft.type === 'comment';
  const needsValue = draft.type !== 'welcome';

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await saveFlowTriggerAction({ ...draft, flowId });
      if (result.error) {
        setError(result.error);
        return;
      }
      setDraft(emptyDraft);
      router.refresh();
    });
  };

  const remove = (id: string) => {
    startTransition(async () => {
      const result = await deleteFlowTriggerAction({ id, flowId });
      if (result.error) setError(result.error);
      else router.refresh();
    });
  };

  const toggleChannel = (channel: string) =>
    setDraft((d) => ({
      ...d,
      channels: d.channels.includes(channel)
        ? d.channels.filter((c) => c !== channel)
        : [...d.channels, channel],
    }));

  const preview: TriggerLike = {
    type: draft.type,
    matchValue: draft.matchValue,
    matchMode: draft.matchMode,
    channels: draft.channels,
  };

  return (
    <div className="space-y-4 p-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">When should this flow run?</p>
        <p className="text-xs text-muted-foreground">
          A flow with no active trigger never starts on its own. Anything that does not match a
          trigger still goes to the AI as normal.
        </p>
      </div>

      <ul className="space-y-2">
        {triggers.length === 0 ? (
          <li className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            No triggers yet.
          </li>
        ) : (
          triggers.map((t) => (
            <li key={t.id} className="space-y-2 rounded-md border p-3">
              <div className="flex items-start justify-between gap-2">
                <Badge variant={t.isActive ? 'success' : 'outline'}>
                  {TRIGGER_TYPE_LABELS[t.type]}
                  {t.isActive ? '' : ' · off'}
                </Badge>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() =>
                      setDraft({
                        id: t.id,
                        type: t.type,
                        matchValue: t.matchValue,
                        matchMode: t.matchMode,
                        channels: t.channels,
                        isActive: t.isActive,
                      })
                    }
                  >
                    Edit
                  </Button>
                  {/* Was a one-tap `Remove` that went straight to
                      `deleteFlowTriggerAction` — no confirmation, no undo, and
                      sitting 8px from an `Edit` button of identical size. Every
                      other destructive action in the product arms first. */}
                  <ConfirmButton
                    label="Remove"
                    confirmLabel="Yes, remove it"
                    question="This flow stops starting on its own from this trigger."
                    disabled={pending}
                    onConfirm={() => remove(t.id)}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{describeTrigger(t)}</p>
            </li>
          ))
        )}
      </ul>

      <div className="space-y-3 rounded-md border bg-muted/30 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {editing ? 'Edit trigger' : 'Add a trigger'}
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="trigger-type" className="text-xs">
            Trigger type
          </Label>
          <Select
            id="trigger-type"
            size="sm"
            value={draft.type}
            onChange={(e) =>
              setDraft((d) => ({ ...d, type: e.target.value as TriggerType, matchValue: '' }))
            }
          >
            {(Object.keys(TRIGGER_TYPE_LABELS) as TriggerType[]).map((t) => (
              <option key={t} value={t}>
                {TRIGGER_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </div>

        {needsValue ? (
          <div className="space-y-1.5">
            <Label htmlFor="trigger-value" className="text-xs">
              {VALUE_LABEL[draft.type]}
            </Label>
            {draft.type === 'intent' ? (
              <Select
                id="trigger-value"
                size="sm"
                value={draft.matchValue}
                onChange={(e) => setDraft((d) => ({ ...d, matchValue: e.target.value }))}
              >
                <option value="">Choose an intent…</option>
                {intents.map((i) => (
                  <option key={i.id} value={i.name}>
                    {i.name}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                id="trigger-value"
                className="h-9 text-sm"
                value={draft.matchValue}
                onChange={(e) => setDraft((d) => ({ ...d, matchValue: e.target.value }))}
                placeholder={draft.type === 'keyword' ? 'pricing' : ''}
              />
            )}
            {draft.type === 'intent' && intents.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                You have no intents yet — create one on the Intents page first.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Fires on the very first message of a brand-new conversation, whatever it says.
          </p>
        )}

        {needsMatchMode ? (
          <div className="space-y-1.5">
            <Label htmlFor="trigger-mode" className="text-xs">
              Match when the message
            </Label>
            <Select
              id="trigger-mode"
              size="sm"
              value={draft.matchMode}
              onChange={(e) => setDraft((d) => ({ ...d, matchMode: e.target.value as MatchMode }))}
            >
              <option value="contains">contains it anywhere</option>
              <option value="exact">is exactly it</option>
              <option value="starts_with">starts with it</option>
              <option value="regex">matches it as a regular expression</option>
            </Select>
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label className="text-xs">Channels</Label>
          <div className="flex flex-wrap gap-1.5">
            {CHANNEL_CHOICES.map((channel) => {
              const on = draft.channels.includes(channel);
              return (
                <button
                  key={channel}
                  type="button"
                  onClick={() => toggleChannel(channel)}
                  aria-pressed={on}
                  className={`rounded-full border px-2.5 py-0.5 text-xs capitalize transition-colors ${
                    on
                      ? 'border-transparent bg-primary text-primary-foreground'
                      : 'bg-background hover:bg-accent'
                  }`}
                >
                  {channel.replace(/_/g, ' ')}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            {draft.channels.length === 0 ? 'Nothing selected means every channel.' : null}
          </p>
        </div>

        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={draft.isActive}
            onChange={(e) => setDraft((d) => ({ ...d, isActive: e.target.checked }))}
            className="h-4 w-4 rounded border-input"
          />
          Active
        </label>

        <p className="rounded-md bg-background p-2 text-xs text-muted-foreground">
          {describeTrigger(preview)}
        </p>

        {error ? (
          <p role="alert" className="text-xs font-medium text-danger-fg">
            {error}
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button type="button" size="sm" disabled={pending} onClick={save}>
            {pending ? 'Saving…' : editing ? 'Save trigger' : 'Add trigger'}
          </Button>
          {editing ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(emptyDraft)}>
              Cancel
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
