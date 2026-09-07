'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { OutboundBlock, OutboundButton } from '@/lib/channels/types';
import type { FlowGraph, FlowState } from '@/lib/flows/types';
import { runFlow } from '@/lib/flows/engine';

/**
 * "Test this flow" — the real engine, in the browser.
 *
 * `src/lib/flows/engine.ts` is pure (no node builtins, no database), so the
 * simulator imports `runFlow` directly instead of round-tripping to a server
 * action. That means the tester is walking the graph currently on the canvas,
 * unsaved edits included, with exactly the semantics production uses.
 *
 * Two honest differences, surfaced in the footer rather than hidden: an
 * "Call an API" block really does fetch from the browser (so a server that does
 * not send CORS headers takes the Failed path), and side effects — tags,
 * assignment, lead capture — are listed instead of applied.
 */

type Entry =
  | { kind: 'bot'; blocks: OutboundBlock[] }
  | { kind: 'user'; text: string }
  | { kind: 'note'; text: string };

function buttonsOf(block: OutboundBlock | undefined): OutboundButton[] {
  if (!block) return [];
  if (block.type === 'buttons') return block.buttons;
  if (block.type === 'quick_replies') return block.options;
  return [];
}

function BlockView({ block }: { block: OutboundBlock }) {
  switch (block.type) {
    case 'text':
      return <p className="whitespace-pre-wrap text-sm">{block.text}</p>;
    case 'image':
    case 'video':
      return (
        <p className="text-sm">
          <span className="font-medium capitalize">{block.type}</span>
          <span className="block break-all text-xs text-muted-foreground">{block.url}</span>
          {block.caption ? <span className="block text-xs">{block.caption}</span> : null}
        </p>
      );
    case 'file':
      return (
        <p className="text-sm">
          📎 {block.name ?? 'File'}
          <span className="block break-all text-xs text-muted-foreground">{block.url}</span>
        </p>
      );
    case 'gallery':
      return (
        <div className="space-y-1">
          {block.items.map((item, i) => (
            <div key={i} className="rounded border bg-background p-2 text-xs">
              <p className="font-medium">{item.title}</p>
              {item.subtitle ? <p className="text-muted-foreground">{item.subtitle}</p> : null}
            </div>
          ))}
        </div>
      );
    case 'buttons':
    case 'quick_replies':
      return <p className="whitespace-pre-wrap text-sm">{block.text}</p>;
    default:
      return null;
  }
}

export function FlowSimulator({ graph }: { graph: FlowGraph }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [awaiting, setAwaiting] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [vars, setVars] = useState<FlowState>({});
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef(graph);
  graphRef.current = graph;

  const scrollDown = () => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  };

  const apply = useCallback(
    async (startNodeId: string | null, text: string | null, state: FlowState) => {
      setBusy(true);
      try {
        const result = await runFlow({
          graph: graphRef.current,
          startNodeId,
          input: text,
          state,
          // Nobody wants to sit through a real 30-second Wait block in a test.
          deps: { maxInlineDelayMs: 200 },
        });
        const notes: Entry[] = [];
        for (const effect of result.effects) {
          if (effect.type === 'tag')
            notes.push({ kind: 'note', text: `Tagged: ${effect.tags.join(', ')}` });
          else if (effect.type === 'assign')
            notes.push({ kind: 'note', text: 'Assigned to a teammate' });
          else if (effect.type === 'save_lead')
            notes.push({ kind: 'note', text: `Lead saved: ${JSON.stringify(effect.fields)}` });
          else if (effect.type === 'subscribe')
            notes.push({
              kind: 'note',
              text: effect.optIn ? 'Opted in to broadcasts' : 'Opted out of broadcasts',
            });
          else if (effect.type === 'jump')
            notes.push({ kind: 'note', text: 'Handed over to another flow' });
        }
        if (result.handoffToAi) {
          notes.push({
            kind: 'note',
            text: result.aiInstruction
              ? `The AI answers this turn — "${result.aiInstruction}"`
              : 'The AI answers this turn',
          });
        }
        if (result.handoffToHuman) notes.push({ kind: 'note', text: 'Escalated to a human agent' });
        if (result.completed) notes.push({ kind: 'note', text: 'Flow finished' });

        setEntries((prev) => [
          ...prev,
          ...(result.blocks.length ? [{ kind: 'bot' as const, blocks: result.blocks }] : []),
          ...notes,
        ]);
        setVars(result.state);
        setAwaiting(result.awaitingNodeId);
        setFinished(result.completed);
        scrollDown();
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const restart = useCallback(() => {
    setEntries([]);
    setVars({});
    setFinished(false);
    setAwaiting(null);
    void apply(null, null, {});
  }, [apply]);

  useEffect(() => {
    restart();
    // Restart only on mount — re-running on every graph keystroke would wipe the
    // conversation the tester is halfway through.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setEntries((prev) => [...prev, { kind: 'user', text: trimmed }]);
    setInput('');
    scrollDown();
    void apply(awaiting, trimmed, vars);
  };

  const lastBot = [...entries].reverse().find((e) => e.kind === 'bot');
  const pendingButtons =
    awaiting && lastBot?.kind === 'bot' ? buttonsOf(lastBot.blocks[lastBot.blocks.length - 1]) : [];
  const collected = Object.entries(vars).filter(([k]) => !k.startsWith('__'));

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b p-3">
        <p className="text-sm font-medium">Test this flow</p>
        <Button type="button" size="sm" variant="outline" onClick={restart} disabled={busy}>
          Restart
        </Button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-3">
        {entries.map((entry, i) => {
          if (entry.kind === 'user') {
            return (
              <div key={i} className="flex justify-end">
                <p className="max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
                  {entry.text}
                </p>
              </div>
            );
          }
          if (entry.kind === 'note') {
            return (
              <p
                key={i}
                className="text-center text-[11px] uppercase tracking-wide text-muted-foreground"
              >
                {entry.text}
              </p>
            );
          }
          return (
            <div key={i} className="space-y-1">
              {entry.blocks.map((block, j) => (
                <div key={j} className="max-w-[90%] rounded-lg bg-muted px-3 py-2">
                  <BlockView block={block} />
                </div>
              ))}
            </div>
          );
        })}
        {busy ? <p className="text-xs text-muted-foreground">Thinking…</p> : null}
      </div>

      {pendingButtons.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 border-t p-3">
          {pendingButtons.map((button, i) => (
            <Button
              key={`${button.value ?? button.label}-${i}`}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => send(button.value ?? button.label)}
            >
              {button.label}
            </Button>
          ))}
        </div>
      ) : null}

      <form
        className="flex gap-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            finished && !awaiting ? 'Flow finished — restart to try again' : 'Type a reply…'
          }
          disabled={busy || (finished && !awaiting)}
          className="h-9"
        />
        <Button type="submit" size="sm" disabled={busy || (finished && !awaiting)}>
          Send
        </Button>
      </form>

      {collected.length > 0 ? (
        <div className="border-t p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Collected so far
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
            {collected.map(([key, value]) => (
              <li key={key}>
                <span className="font-medium text-foreground">{key}</span>: {String(value)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="border-t p-3 text-[11px] text-muted-foreground">
        This runs the real flow engine on the graph you can see, including unsaved edits. API blocks
        call out from your browser, and tags, assignment and lead capture are listed rather than
        applied.
      </p>
    </div>
  );
}
