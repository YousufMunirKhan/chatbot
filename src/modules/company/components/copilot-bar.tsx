'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

type Mode = 'suggest_reply' | 'summarise' | 'rephrase';

interface CopilotResponse {
  mode: Mode;
  text: string;
  citations?: Array<{ index?: number; title?: string; url?: string | null }>;
  disclaimer?: string;
}

/**
 * The assistant, working for the agent instead of the customer.
 *
 * Three jobs, all of which the model was already capable of and none of which
 * an agent could reach: draft a reply from the thread and the company's own
 * knowledge, summarise a long conversation before picking it up, and rewrite
 * whatever is already in the box in a different tone.
 *
 * Nothing here sends anything. A suggestion lands in the reply box for a person
 * to read, edit and decide on, and the disclaimer stays visible while it sits
 * there — a drafted reply that goes out unread is worse than no draft at all.
 */
export function CopilotBar({
  conversationId,
  getDraft,
  onText,
}: {
  conversationId: string;
  /** Current contents of the reply box, for rephrase. */
  getDraft: () => string;
  /** Put a drafted or rewritten reply into the box. */
  onText: (text: string) => void;
}) {
  const [busy, setBusy] = useState<Mode | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(mode: Mode) {
    setError(null);
    if (mode === 'rephrase' && !getDraft().trim()) {
      setError('Write something first, then this will rewrite it.');
      return;
    }
    setBusy(mode);
    try {
      const res = await fetch('/api/company/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          mode,
          draft: mode === 'rephrase' ? getDraft() : undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? 'That did not work. Try again in a moment.');
        return;
      }
      const data = (await res.json()) as CopilotResponse;
      setNote(data.disclaimer ?? null);
      if (mode === 'summarise') setSummary(data.text);
      else {
        setSummary(null);
        onText(data.text);
      }
    } catch {
      setError('Could not reach the assistant. Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  }

  const label = (mode: Mode, idle: string, working: string) => (busy === mode ? working : idle);

  return (
    <div className="space-y-2 rounded-md border bg-muted/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Assistant
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() => run('suggest_reply')}
        >
          {label('suggest_reply', 'Draft a reply', 'Drafting…')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() => run('summarise')}
        >
          {label('summarise', 'Summarise the chat', 'Reading…')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() => run('rephrase')}
        >
          {label('rephrase', 'Rewrite mine', 'Rewriting…')}
        </Button>
      </div>

      {summary ? (
        <div className="rounded border bg-background p-3">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Summary</p>
          <p className="whitespace-pre-wrap text-sm">{summary}</p>
        </div>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {note && !error ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}
