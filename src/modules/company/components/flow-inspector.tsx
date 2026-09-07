'use client';

import { memo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type {
  AskValidation,
  ConditionOperator,
  FlowChoice,
  FlowNode,
  FlowNodeData,
} from '@/lib/flows/types';
import { newChoice, nodeTypeLabel } from '../flow-graph';

/**
 * Right-hand properties panel.
 *
 * Every editor writes through one `patch()` call, so the builder receives a
 * whole `FlowNodeData` and can decide on its own whether the change is worth a
 * history entry. Nothing here re-lays-out the canvas: only the edited node's
 * object identity changes, and the memoised node cards leave the rest alone.
 */

export interface InspectorProps {
  node: FlowNode | null;
  onChange: (nodeId: string, data: FlowNodeData) => void;
  onDelete: (nodeId: string) => void;
  flowOptions: Array<{ id: string; name: string }>;
  agents: Array<{ id: string; name: string }>;
}

const VALIDATIONS: Array<{ value: AskValidation; label: string }> = [
  { value: 'text', label: 'Any text' },
  { value: 'email', label: 'Email address' },
  { value: 'phone', label: 'Phone number' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'url', label: 'Web address' },
];

const OPERATORS: Array<{ value: ConditionOperator; label: string }> = [
  { value: 'equals', label: 'is exactly' },
  { value: 'not_equals', label: 'is not' },
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: 'does not contain' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'is_set', label: 'has any value' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'greater_than', label: 'is greater than' },
  { value: 'less_than', label: 'is less than' },
];

const NO_VALUE_OPS: ConditionOperator[] = ['is_set', 'is_empty'];

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** `key=value` lines are far easier to edit than a JSON blob for headers/maps. */
function pairsToText(pairs: Record<string, string> | undefined): string {
  return Object.entries(pairs ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

function textToPairs(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

function ChoiceEditor({
  choices,
  onChange,
}: {
  choices: FlowChoice[];
  onChange: (next: FlowChoice[]) => void;
}) {
  const move = (index: number, delta: number) => {
    const next = [...choices];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const a = next[index];
    const b = next[target];
    if (!a || !b) return;
    next[index] = b;
    next[target] = a;
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {choices.map((choice, index) => (
        <div key={choice.id} className="space-y-1.5 rounded-md border p-2">
          <div className="flex items-center gap-1.5">
            <Input
              value={choice.label}
              onChange={(e) =>
                onChange(choices.map((c, i) => (i === index ? { ...c, label: e.target.value } : c)))
              }
              placeholder="Button label"
              className="h-8 text-sm"
              maxLength={60}
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0"
              aria-label={`Move ${choice.label} up`}
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              ↑
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0"
              aria-label={`Move ${choice.label} down`}
              disabled={index === choices.length - 1}
              onClick={() => move(index, 1)}
            >
              ↓
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0 text-danger-fg"
              aria-label={`Remove ${choice.label}`}
              onClick={() => onChange(choices.filter((_, i) => i !== index))}
            >
              ×
            </Button>
          </div>
          <Input
            value={choice.url ?? ''}
            onChange={(e) =>
              onChange(
                choices.map((c, i) =>
                  i === index ? { ...c, url: e.target.value || undefined } : c,
                ),
              )
            }
            placeholder="Optional link (opens instead of continuing)"
            className="h-8 text-xs"
          />
          <p className="text-[11px] text-muted-foreground">
            id <code className="rounded bg-muted px-1">{choice.id}</code> — this is what the
            connection out of this choice is wired to.
          </p>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => onChange([...choices, newChoice(choices)])}
      >
        Add a choice
      </Button>
    </div>
  );
}

function InspectorBody({
  node,
  onChange,
  flowOptions,
  agents,
}: Omit<InspectorProps, 'onDelete'> & { node: FlowNode }) {
  const data = node.data;
  const patch = useCallback(
    (next: Partial<FlowNodeData>) => onChange(node.id, { ...node.data, ...next }),
    [node.id, node.data, onChange],
  );

  const textField = (label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <Textarea
        value={data.text ?? ''}
        onChange={(e) => patch({ text: e.target.value })}
        rows={3}
        placeholder="Type what the customer sees…"
      />
    </Field>
  );

  switch (node.type) {
    case 'start':
      return (
        <p className="text-sm text-muted-foreground">
          Every conversation that matches a trigger enters here. Connect it to the first block you
          want to send.
        </p>
      );

    case 'message':
    case 'end':
    case 'handoff':
      return (
        <>
          {textField(
            'Message',
            'Use {{variable}} to drop in an answer you collected earlier, e.g. “Thanks {{name}}!”.',
          )}
          {node.type === 'handoff' ? (
            <p className="text-xs text-muted-foreground">
              After this block the conversation belongs to a human — the flow stops here.
            </p>
          ) : null}
        </>
      );

    case 'image':
    case 'video':
      return (
        <>
          <Field label={node.type === 'image' ? 'Image URL' : 'Video URL'}>
            <Input
              value={data.url ?? ''}
              onChange={(e) => patch({ url: e.target.value })}
              placeholder="https://…"
            />
          </Field>
          <Field label="Caption">
            <Input
              value={data.caption ?? ''}
              onChange={(e) => patch({ caption: e.target.value })}
            />
          </Field>
        </>
      );

    case 'file':
      return (
        <>
          <Field label="File URL">
            <Input
              value={data.url ?? ''}
              onChange={(e) => patch({ url: e.target.value })}
              placeholder="https://…"
            />
          </Field>
          <Field label="File name">
            <Input
              value={data.fileName ?? ''}
              onChange={(e) => patch({ fileName: e.target.value })}
              placeholder="price-list.pdf"
            />
          </Field>
        </>
      );

    case 'gallery': {
      const items = data.items ?? [];
      return (
        <Field label="Cards" hint="Each card can carry its own title, subtitle and image.">
          <div className="space-y-2">
            {items.map((item, index) => (
              <div key={index} className="space-y-1.5 rounded-md border p-2">
                <Input
                  value={item.title}
                  onChange={(e) =>
                    patch({
                      items: items.map((it, i) =>
                        i === index ? { ...it, title: e.target.value } : it,
                      ),
                    })
                  }
                  placeholder="Card title"
                  className="h-8 text-sm"
                />
                <Input
                  value={item.subtitle ?? ''}
                  onChange={(e) =>
                    patch({
                      items: items.map((it, i) =>
                        i === index ? { ...it, subtitle: e.target.value } : it,
                      ),
                    })
                  }
                  placeholder="Subtitle"
                  className="h-8 text-xs"
                />
                <Input
                  value={item.imageUrl ?? ''}
                  onChange={(e) =>
                    patch({
                      items: items.map((it, i) =>
                        i === index ? { ...it, imageUrl: e.target.value } : it,
                      ),
                    })
                  }
                  placeholder="Image URL"
                  className="h-8 text-xs"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-danger-fg"
                  onClick={() => patch({ items: items.filter((_, i) => i !== index) })}
                >
                  Remove card
                </Button>
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => patch({ items: [...items, { title: 'New card' }] })}
            >
              Add a card
            </Button>
          </div>
        </Field>
      );
    }

    case 'ask':
      return (
        <>
          {textField('Question')}
          <Field
            label="Save the answer as"
            hint="The variable name you reference later as {{name}}."
          >
            <Input
              value={data.variable ?? ''}
              onChange={(e) => patch({ variable: e.target.value.replace(/[^\w]/g, '_') })}
              placeholder="email"
            />
          </Field>
          <Field label="Answer must be">
            <Select
              value={data.validation ?? 'text'}
              onChange={(e) => patch({ validation: e.target.value as AskValidation })}
            >
              {VALIDATIONS.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="If the answer does not fit">
            <Input
              value={data.retryText ?? ''}
              onChange={(e) => patch({ retryText: e.target.value })}
              placeholder="Sorry, that does not look right — try again?"
            />
          </Field>
          <Field
            label="Retries before moving on"
            hint="After this many failed tries the flow keeps the raw answer and continues, rather than trapping the customer."
          >
            <Input
              type="number"
              min={0}
              max={5}
              value={data.maxRetries ?? 2}
              onChange={(e) => patch({ maxRetries: Number(e.target.value) })}
            />
          </Field>
        </>
      );

    case 'buttons':
    case 'quick_replies':
      return (
        <>
          {textField('Message above the choices')}
          <Field label="Save the choice as">
            <Input
              value={data.variable ?? ''}
              onChange={(e) => patch({ variable: e.target.value.replace(/[^\w]/g, '_') })}
              placeholder="menu_choice"
            />
          </Field>
          <Field
            label="Choices"
            hint="Each choice gets its own output handle on the block. Anything unrecognised takes the “Anything else” path."
          >
            <ChoiceEditor choices={data.choices ?? []} onChange={(choices) => patch({ choices })} />
          </Field>
        </>
      );

    case 'csat':
      return (
        <>
          {textField('Rating question', 'The customer replies with a number from 1 to 5.')}
          <Field label="If they reply with something else">
            <Input
              value={data.retryText ?? ''}
              onChange={(e) => patch({ retryText: e.target.value })}
              placeholder="Please reply with a number from 1 to 5."
            />
          </Field>
        </>
      );

    case 'condition': {
      const clauses = data.conditions ?? [];
      return (
        <>
          <Field label="Take the Yes path when">
            <Select
              value={data.match ?? 'all'}
              onChange={(e) => patch({ match: e.target.value as 'all' | 'any' })}
            >
              <option value="all">Every rule below matches</option>
              <option value="any">Any rule below matches</option>
            </Select>
          </Field>
          <div className="space-y-2">
            {clauses.map((clause, index) => (
              <div key={index} className="space-y-1.5 rounded-md border p-2">
                <Input
                  value={clause.variable}
                  onChange={(e) =>
                    patch({
                      conditions: clauses.map((c, i) =>
                        i === index ? { ...c, variable: e.target.value } : c,
                      ),
                    })
                  }
                  placeholder="variable name"
                  className="h-8 text-sm"
                />
                <Select
                  size="sm"
                  value={clause.operator}
                  onChange={(e) =>
                    patch({
                      conditions: clauses.map((c, i) =>
                        i === index ? { ...c, operator: e.target.value as ConditionOperator } : c,
                      ),
                    })
                  }
                >
                  {OPERATORS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
                {NO_VALUE_OPS.includes(clause.operator) ? null : (
                  <Input
                    value={clause.value ?? ''}
                    onChange={(e) =>
                      patch({
                        conditions: clauses.map((c, i) =>
                          i === index ? { ...c, value: e.target.value } : c,
                        ),
                      })
                    }
                    placeholder="value"
                    className="h-8 text-sm"
                  />
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-danger-fg"
                  onClick={() => patch({ conditions: clauses.filter((_, i) => i !== index) })}
                >
                  Remove rule
                </Button>
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                patch({ conditions: [...clauses, { variable: '', operator: 'equals', value: '' }] })
              }
            >
              Add a rule
            </Button>
          </div>
        </>
      );
    }

    case 'delay':
      return (
        <Field
          label="Wait for"
          hint="Long waits are shortened by the runtime so a channel webhook still answers in time — use this for a natural typing pause, not a scheduled follow-up."
        >
          <Input
            type="number"
            min={0}
            max={60}
            value={data.seconds ?? 0}
            onChange={(e) => patch({ seconds: Number(e.target.value) })}
          />
        </Field>
      );

    case 'jump':
      return (
        <Field
          label="Continue in this flow"
          hint="The current flow ends and the chosen one takes over."
        >
          <Select
            value={data.targetFlowId ?? ''}
            onChange={(e) => patch({ targetFlowId: e.target.value || undefined })}
          >
            <option value="">Choose a flow…</option>
            {flowOptions.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
        </Field>
      );

    case 'tag':
      return (
        <Field label="Tags" hint="Comma separated. Used to segment contacts for broadcasts.">
          <Input
            value={(data.tags ?? []).join(', ')}
            onChange={(e) =>
              patch({
                tags: e.target.value
                  .split(',')
                  .map((t) => t.trim())
                  .filter(Boolean),
              })
            }
            placeholder="vip, quote-request"
          />
        </Field>
      );

    case 'assign':
      return (
        <Field
          label="Assign to"
          hint="Leave on “Anyone available” to fall back to your normal routing."
        >
          <Select
            value={data.agentId ?? ''}
            onChange={(e) => patch({ agentId: e.target.value || undefined })}
          >
            <option value="">Anyone available</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
      );

    case 'subscribe':
      return (
        <Field label="Broadcast list">
          <Select
            value={data.optIn === false ? 'out' : 'in'}
            onChange={(e) => patch({ optIn: e.target.value === 'in' })}
          >
            <option value="in">Opt this contact in</option>
            <option value="out">Opt this contact out</option>
          </Select>
        </Field>
      );

    case 'save_lead': {
      const fields = data.leadFields ?? {};
      return (
        <Field
          label="Lead fields"
          hint="One per line as “field: {{variable}}”. name, email, phone and notes are recognised."
        >
          <Textarea
            rows={5}
            defaultValue={pairsToText(fields)}
            onBlur={(e) => patch({ leadFields: textToPairs(e.target.value) })}
            placeholder={'name: {{name}}\nemail: {{email}}'}
          />
        </Field>
      );
    }

    case 'http':
      return (
        <>
          <Field label="Method">
            <Select
              value={data.method ?? 'GET'}
              onChange={(e) => patch({ method: e.target.value as FlowNodeData['method'] })}
            >
              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="URL"
            hint="Variables work here too: https://api.you.com/orders/{{order_number}}"
          >
            <Input
              value={data.url ?? ''}
              onChange={(e) => patch({ url: e.target.value })}
              placeholder="https://…"
            />
          </Field>
          <Field label="Headers" hint="One per line as “Header: value”.">
            <Textarea
              rows={3}
              defaultValue={pairsToText(data.headers)}
              onBlur={(e) => patch({ headers: textToPairs(e.target.value) })}
              placeholder="Authorization: Bearer …"
            />
          </Field>
          {data.method && data.method !== 'GET' && data.method !== 'DELETE' ? (
            <Field label="Body">
              <Textarea
                rows={4}
                value={data.body ?? ''}
                onChange={(e) => patch({ body: e.target.value })}
                placeholder={'{"order": "{{order_number}}"}'}
              />
            </Field>
          ) : null}
          <Field
            label="Save from the response"
            hint="One per line as “variable: path.in.the.json”. The Succeeded / Failed handles branch on the HTTP status."
          >
            <Textarea
              rows={3}
              defaultValue={pairsToText(data.responseMap)}
              onBlur={(e) => patch({ responseMap: textToPairs(e.target.value) })}
              placeholder="order_status: data.status"
            />
          </Field>
        </>
      );

    case 'ai':
      return (
        <Field
          label="Extra instruction"
          hint="Layered on top of the assistant's own prompt for this one turn. Leave blank to use it as-is."
        >
          <Textarea
            rows={4}
            value={data.instruction ?? ''}
            onChange={(e) => patch({ instruction: e.target.value })}
            placeholder="Answer using the delivery policy, and offer a human if unsure."
          />
        </Field>
      );

    case 'random':
      return (
        <p className="text-sm text-muted-foreground">
          Traffic is split evenly across the connected outputs — useful for testing two versions of
          the same path against each other.
        </p>
      );

    default:
      return <p className="text-sm text-muted-foreground">This block has no settings.</p>;
  }
}

export const FlowInspector = memo(function FlowInspector({
  node,
  onChange,
  onDelete,
  flowOptions,
  agents,
}: InspectorProps) {
  if (!node) {
    return (
      <div className="space-y-2 p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Nothing selected</p>
        <p>
          Click a block on the canvas to edit what it says and does. Drag from a block&apos;s
          right-hand dot to the next block to connect them.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <div className="space-y-1.5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {nodeTypeLabel(node.type)}
        </p>
        <Input
          value={node.data.label ?? ''}
          onChange={(e) => onChange(node.id, { ...node.data, label: e.target.value })}
          placeholder="Block name (only you see this)"
          className="h-9"
        />
      </div>

      {/* Keyed on the node: the headers / lead-fields / response-map editors are
          uncontrolled (they commit on blur, not per keystroke), so selecting a
          different block has to remount them or they would keep showing the
          previous block's text. */}
      <InspectorBody
        key={node.id}
        node={node}
        onChange={onChange}
        flowOptions={flowOptions}
        agents={agents}
      />

      {node.type === 'start' ? null : (
        <div className="border-t pt-3">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-danger-fg"
            onClick={() => onDelete(node.id)}
          >
            Delete this block
          </Button>
        </div>
      )}
    </div>
  );
});
