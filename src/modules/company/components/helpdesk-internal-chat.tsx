'use client';

import { useMemo, useState } from 'react';
import { ArrowRight, ExternalLink, Loader2, Play, Route, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Pill = { id: string; label: string; message: string; source: string; contextMode: string };
type NavigationTarget = { label: string; routeId: string; path: string | null; module: string; screen: string };
type GuidedAction = {
  id: string;
  name: string;
  label: string;
  description: string;
  type: string;
  risk: string;
  requiredFields: string[];
  optionalFields: string[];
  needsConfirmation: boolean;
};

interface ChatResponse {
  answer: string;
  pills: Pill[];
  navigationTargets: NavigationTarget[];
  guidedActions: GuidedAction[];
}

interface Message {
  role: 'staff' | 'assistant';
  text: string;
}

function title(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export function HelpdeskInternalChat({ initialPills }: { initialPills: string[] }) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      text: 'Ask about screens, paths, reports, stock, products, or safe updates.',
    },
  ]);
  const [text, setText] = useState('');
  const [route, setRoute] = useState('dashboard');
  const [loading, setLoading] = useState(false);
  const [last, setLast] = useState<ChatResponse | null>(null);
  const [activeAction, setActiveAction] = useState<GuidedAction | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [actionConfirmed, setActionConfirmed] = useState(false);

  const visiblePills = useMemo(() => {
    if (last?.pills?.length) return last.pills;
    return initialPills.slice(0, 6).map((label, index) => ({
      id: `initial-${index}`,
      label,
      message: label,
      source: 'default',
      contextMode: 'initial',
    }));
  }, [initialPills, last?.pills]);

  async function ask(message: string) {
    const clean = message.trim();
    if (!clean || loading) return;
    setLoading(true);
    setText('');
    setMessages((current) => [...current, { role: 'staff', text: clean }]);
    try {
      const res = await fetch('/api/helpdesk/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: clean, currentRoute: route }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Help Desk chat failed.');
      setLast(data);
      setMessages((current) => [...current, { role: 'assistant', text: data.answer || 'No answer.' }]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        { role: 'assistant', text: error instanceof Error ? error.message : 'Help Desk chat failed.' },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function submitGuidedAction() {
    if (!activeAction) return;
    if (activeAction.needsConfirmation && !actionConfirmed) return;
    const fields = [...activeAction.requiredFields, ...activeAction.optionalFields];
    const details = fields
      .map((field) => `${field}: ${formValues[field] ?? ''}`)
      .filter((line) => !line.endsWith(': '))
      .join(', ');
    const confirmText = activeAction.needsConfirmation ? ', confirmed: true' : '';
    void ask(`Run ${activeAction.name} with ${details}${confirmText}`);
    setActiveAction(null);
    setFormValues({});
    setActionConfirmed(false);
  }

  return (
    <div className="rounded-lg border bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b p-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="font-semibold">Staff Help Desk Chat</h2>
          <p className="text-sm text-muted-foreground">Internal-only chat with route-aware pills and connector actions.</p>
        </div>
        <div className="flex items-center gap-2">
          <Route className="h-4 w-4 text-muted-foreground" />
          <Input value={route} onChange={(event) => setRoute(event.target.value)} className="h-9 w-48" />
        </div>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <div className="h-[420px] overflow-y-auto rounded-md border bg-slate-50 p-3">
            <div className="space-y-3">
              {messages.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  className={message.role === 'staff' ? 'ml-auto max-w-[82%] rounded-md bg-primary p-3 text-sm text-primary-foreground' : 'mr-auto max-w-[88%] rounded-md bg-white p-3 text-sm leading-6 shadow-sm'}
                >
                  {message.text}
                </div>
              ))}
              {loading ? (
                <div className="mr-auto inline-flex items-center gap-2 rounded-md bg-white p-3 text-sm text-muted-foreground shadow-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Checking helpdesk knowledge
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {visiblePills.map((pill) => (
              <button
                key={pill.id}
                type="button"
                onClick={() => ask(pill.message)}
                className="inline-flex items-center gap-1 rounded-full border bg-white px-3 py-1.5 text-xs font-medium hover:bg-muted"
              >
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                {pill.label}
              </button>
            ))}
          </div>

          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void ask(text);
            }}
          >
            <Input value={text} onChange={(event) => setText(event.target.value)} placeholder="Ask staff helpdesk..." />
            <Button type="submit" disabled={loading} size="icon" aria-label="Ask">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            </Button>
          </form>
        </div>

        <aside className="space-y-4">
          <div className="rounded-md border p-3">
            <div className="mb-2 text-sm font-semibold">Open Sections</div>
            <div className="space-y-2">
              {(last?.navigationTargets ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">Navigation buttons appear when connector docs include route IDs.</p>
              ) : (
                last!.navigationTargets.map((target) => (
                  <button
                    key={target.routeId}
                    type="button"
                    onClick={() => ask(`Open ${target.screen}`)}
                    className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-xs hover:bg-muted"
                    title={target.routeId}
                  >
                    <span>
                      <span className="block font-medium">{target.label}</span>
                      <span className="text-muted-foreground">{target.path ?? target.routeId}</span>
                    </span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="rounded-md border p-3">
            <div className="mb-2 text-sm font-semibold">Guided Actions</div>
            <div className="space-y-2">
              {(last?.guidedActions ?? []).slice(0, 6).map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => {
                    setActiveAction(action);
                    setActionConfirmed(false);
                  }}
                  className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-xs hover:bg-muted"
                >
                  <span>
                    <span className="block font-medium">{action.label}</span>
                    <span className="text-muted-foreground">{action.type} / {action.risk}</span>
                  </span>
                  <Play className="h-3.5 w-3.5" />
                </button>
              ))}
              {(last?.guidedActions ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">Run a question first to load enabled connector actions.</p>
              ) : null}
            </div>
          </div>

          {activeAction ? (
            <div className="rounded-md border border-primary/40 bg-primary/5 p-3">
              <div className="font-semibold">{activeAction.label}</div>
              <p className="mt-1 text-xs text-muted-foreground">{activeAction.description}</p>
              <div className="mt-3 space-y-2">
                {[...activeAction.requiredFields, ...activeAction.optionalFields].map((field) => (
                  <Input
                    key={field}
                    placeholder={`${title(field)}${activeAction.requiredFields.includes(field) ? ' *' : ''}`}
                    value={formValues[field] ?? ''}
                    onChange={(event) => setFormValues((current) => ({ ...current, [field]: event.target.value }))}
                  />
                ))}
              </div>
              {activeAction.needsConfirmation ? (
                <label className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950">
                  <input
                    type="checkbox"
                    checked={actionConfirmed}
                    onChange={(event) => setActionConfirmed(event.target.checked)}
                    className="mt-0.5 h-4 w-4"
                  />
                  Confirm this action can change data in the connected system. The connector should still honor dry-run and local safety checks.
                </label>
              ) : null}
              <div className="mt-3 flex gap-2">
                <Button type="button" size="sm" onClick={submitGuidedAction} disabled={activeAction.needsConfirmation && !actionConfirmed}>
                  {activeAction.needsConfirmation ? 'Confirm and run' : 'Run'}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => {
                  setActiveAction(null);
                  setActionConfirmed(false);
                }}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
