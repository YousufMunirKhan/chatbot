'use client';

import { useState, useTransition } from 'react';
import { useFormState } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { SubmitButton } from '@/components/ui/submit-button';
import { Textarea } from '@/components/ui/textarea';
import {
  saveIntentAction,
  saveNluSettingsAction,
  testIntentAction,
  type TestIntentState,
} from '../flows-actions';
import type { IntentRow, NluProvider, NluSettings } from '../flows-data';

/**
 * Intents are how a flow starts from *meaning* rather than an exact keyword:
 * "where's my stuff", "has it shipped" and "order update" all reach the same
 * flow once they are examples of one intent.
 */

const PROVIDER_COPY: Record<NluProvider, { label: string; hint: string; needsToken: boolean }> = {
  builtin: {
    label: 'Built-in classifier',
    hint: 'Matches against your example phrases. No account, no token, works offline.',
    needsToken: false,
  },
  wit: {
    label: 'wit.ai',
    hint: 'Meta’s free NLU service. Paste a Server Access Token from your wit.ai app settings.',
    needsToken: true,
  },
  intnt: {
    label: 'INTNT.ai',
    hint: 'Commercial intent classification. Paste the API key from your INTNT dashboard.',
    needsToken: true,
  },
};

// ---------------------------------------------------------------------------
// Chips input
// ---------------------------------------------------------------------------
function PhraseChips({
  phrases,
  onChange,
}: {
  phrases: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState('');

  const add = (raw: string) => {
    const parts = raw
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    const next = [...phrases];
    for (const part of parts) if (!next.includes(part)) next.push(part);
    onChange(next);
    setDraft('');
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {phrases.map((phrase) => (
          <span
            key={phrase}
            className="inline-flex items-center gap-1 rounded-full border bg-muted px-2.5 py-0.5 text-xs"
          >
            {phrase}
            <button
              type="button"
              aria-label={`Remove ${phrase}`}
              className="text-muted-foreground hover:text-danger-fg"
              onClick={() => onChange(phrases.filter((p) => p !== phrase))}
            >
              ×
            </button>
          </span>
        ))}
        {phrases.length === 0 ? (
          <span className="text-xs text-muted-foreground">No examples yet.</span>
        ) : null}
      </div>
      {/* Placeholder-only: this input announced as an unnamed text box, and
          the placeholder disappears the moment anything is typed. */}
      <Input
        aria-label="Add an example phrase"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add(draft);
          } else if (e.key === 'Backspace' && draft === '' && phrases.length > 0) {
            onChange(phrases.slice(0, -1));
          }
        }}
        onBlur={() => add(draft)}
        placeholder="Type an example and press Enter — e.g. “where is my order”"
        className="h-9"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create / edit an intent
// ---------------------------------------------------------------------------
export function IntentEditor({ intents }: { intents: IntentRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<IntentRow | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [phrases, setPhrases] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setEditing(null);
    setName('');
    setDescription('');
    setPhrases([]);
    setError(null);
  };

  const load = (intent: IntentRow) => {
    setEditing(intent);
    setName(intent.name);
    setDescription(intent.description ?? '');
    setPhrases(intent.examples);
    setError(null);
    setSaved(false);
  };

  const submit = () => {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await saveIntentAction({
        id: editing?.id,
        name,
        description,
        examples: phrases,
        provider: editing?.provider ?? 'builtin',
        isActive: editing?.isActive ?? true,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setSaved(true);
      reset();
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{editing ? `Edit “${editing.name}”` : 'Add an intent'}</CardTitle>
        <CardDescription>
          Give it a short machine-friendly name and a handful of ways a real customer might phrase
          it. Five or six varied examples beat twenty near-identical ones.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <FormField
          label="Intent name"
          htmlFor="intent-name"
          required
          hint="Letters, numbers, dashes and underscores. This is what a flow trigger points at."
        >
          <Input
            id="intent-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="order_status"
            maxLength={60}
          />
        </FormField>

        <FormField label="Description" htmlFor="intent-description">
          <Textarea
            id="intent-description"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Customer wants to know where their order has got to."
          />
        </FormField>

        {/* A bare `<Label>` with no `htmlFor` renders a `<label>` bound to
            nothing, so the chip list and its input announced as unnamed
            controls. `fieldset`/`legend` is what names a group. */}
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium leading-none">Example phrases</legend>
          <PhraseChips phrases={phrases} onChange={setPhrases} />
          <p className="text-xs text-muted-foreground">
            Different ways a customer might say the same thing. {phrases.length} added so far — at
            least two are needed before this can be saved.
          </p>
        </fieldset>

        {error ? (
          <p role="alert" className="text-sm font-medium text-danger-fg">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p role="status" className="text-sm font-medium text-success-fg">
            Saved.
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button type="button" disabled={pending} onClick={submit}>
            {pending ? 'Saving…' : editing ? 'Save changes' : 'Add intent'}
          </Button>
          {editing ? (
            <Button type="button" variant="ghost" onClick={reset}>
              Cancel
            </Button>
          ) : null}
        </div>

        {intents.length > 0 ? (
          <div className="border-t pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Edit an existing intent
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {intents.map((intent) => (
                <button
                  key={intent.id}
                  type="button"
                  onClick={() => load(intent)}
                  className="rounded-full border px-2.5 py-0.5 text-xs hover:bg-accent"
                >
                  {intent.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Provider + token
// ---------------------------------------------------------------------------
export function NluSettingsForm({ settings }: { settings: NluSettings }) {
  const router = useRouter();
  const [provider, setProvider] = useState<NluProvider>(settings.provider);
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const copy = PROVIDER_COPY[provider];

  const submit = (clearToken = false) => {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await saveNluSettingsAction({ provider, token, clearToken });
      if (result.error) {
        setError(result.error);
        return;
      }
      setToken('');
      setSaved(true);
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>How intents are matched</CardTitle>
        <CardDescription>
          The built-in classifier needs nothing set up. Point it at wit.ai or INTNT when you want a
          model that generalises further than your examples.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <FormField label="Provider" htmlFor="nlu-provider" hint={copy.hint}>
          <Select
            id="nlu-provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value as NluProvider)}
          >
            {(Object.keys(PROVIDER_COPY) as NluProvider[]).map((key) => (
              <option key={key} value={key}>
                {PROVIDER_COPY[key].label}
              </option>
            ))}
          </Select>
        </FormField>

        {copy.needsToken ? (
          <FormField
            label="Access token"
            htmlFor="nlu-token"
            hint={
              settings.hasToken
                ? 'A token is already stored, encrypted. Leave blank to keep it.'
                : 'Stored encrypted at rest and never shown again.'
            }
          >
            <Input
              id="nlu-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={settings.hasToken ? '••••••••••••' : 'Paste the token'}
              autoComplete="off"
            />
          </FormField>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm font-medium text-danger-fg">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p role="status" className="text-sm font-medium text-success-fg">
            Saved.
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button type="button" disabled={pending} onClick={() => submit(false)}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
          {settings.hasToken ? (
            <Button type="button" variant="ghost" disabled={pending} onClick={() => submit(true)}>
              Remove stored token
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Test bench
// ---------------------------------------------------------------------------
const initialTest: TestIntentState = {};

export function IntentTester() {
  const [state, action] = useFormState(testIntentAction, initialTest);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Test a phrase</CardTitle>
        <CardDescription>
          Type what a customer might say and see which intent it lands on — before you wire it to a
          flow.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form action={action} className="flex flex-col gap-2 sm:flex-row">
          {/* Placeholder-only. It reads as a label until the moment anyone
              types, and a screen reader never got one at all. */}
          <Input
            name="phrase"
            aria-label="A phrase to test"
            placeholder="e.g. hasn’t my parcel arrived yet?"
            className="flex-1"
          />
          <SubmitButton className="shrink-0" pendingLabel="Checking…">
            Test
          </SubmitButton>
        </form>
        <FormMessage state={{ error: state.error }} />
        {state.ok ? (
          <div className="rounded-lg border bg-muted/30 p-4 text-sm">
            {state.intent ? (
              <p>
                Matched <Badge variant="success">{state.intent}</Badge>{' '}
                <span className="text-muted-foreground">
                  ({Math.round((state.confidence ?? 0) * 100)}% confidence
                  {state.source === 'builtin' ? ', built-in classifier' : ''})
                </span>
              </p>
            ) : (
              <p className="text-muted-foreground">
                {state.source === 'none'
                  ? 'No intents to match against yet — add one above.'
                  : 'No match. The assistant would answer this one itself.'}
              </p>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
