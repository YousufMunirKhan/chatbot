'use client';

import { useFormState, useFormStatus } from 'react-dom';
import {
  ArrowRight,
  Bot,
  Boxes,
  ChevronRight,
  Clock3,
  Mic,
  Search,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { cn } from '@/lib/utils';
import { testAssistantAction, type TestAssistantState } from '../test-assistant-actions';
import { CHOICE_GRID } from './form-layout';

const initial: TestAssistantState = {};

const fallbackSuggestions = [
  'How do I add a product?',
  'Check today sales report',
  'Where is stock adjustment?',
];

const chips = ['For You', 'Products', 'Reports', 'Stock', 'Customers'];

function AskButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      disabled={pending}
      size="icon"
      className="h-10 w-10 rounded-full bg-[#5b3ff4] text-white hover:bg-[#4930d8]"
      aria-label="Ask assistant"
      title="Ask assistant"
    >
      {pending ? (
        <Sparkles className="h-4 w-4 animate-pulse" />
      ) : (
        <ArrowRight className="h-4 w-4" />
      )}
    </Button>
  );
}

export function HelpdeskChatPreview({
  suggestions = fallbackSuggestions,
}: {
  suggestions?: string[];
}) {
  const [state, action] = useFormState(testAssistantAction, initial);
  const visibleSuggestions = suggestions.length ? suggestions.slice(0, 5) : fallbackSuggestions;

  return (
    <section className="grid gap-6 lg:grid-cols-[minmax(320px,0.95fr)_1.05fr] [&>*]:min-w-0">
      {/* DELIBERATELY FIXED-LIGHT. This whole panel is a picture of the staff
          chat as it looks inside the customer's own software — its white, its
          slate greys and its violet belong to the thing being depicted, not to
          this dashboard, and must not follow the dashboard's theme. Same
          exception as the sidebar gradient. Nothing here is interactive except
          the ask box at the bottom. */}
      <div className="overflow-hidden rounded-lg border bg-white shadow-sm">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div className="inline-flex rounded-full bg-slate-100 p-1 text-sm font-medium">
            <button
              className="rounded-full bg-white px-4 py-2 text-slate-950 shadow-sm"
              type="button"
            >
              Chat
            </button>
            <button className="px-4 py-2 text-slate-500" type="button">
              History
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="grid h-9 w-9 place-items-center rounded-full text-[#5b3ff4] hover:bg-violet-50"
              aria-label="Smart actions"
              title="Smart actions"
            >
              <Sparkles className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="grid h-9 w-9 place-items-center rounded-full text-slate-700 hover:bg-slate-100"
              aria-label="Open workspace"
              title="Open workspace"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex min-h-[610px] flex-col px-5 pb-5 pt-12">
          <div className="flex flex-1 flex-col items-center text-center">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-[#5b3ff4] text-white shadow-sm">
              <Bot className="h-8 w-8" />
            </div>
            <h2 className="mt-5 text-2xl font-semibold tracking-tight text-slate-950">
              Hello Aamir
            </h2>
            <p className="mt-2 text-base text-slate-600">How can the assistant help you today?</p>
          </div>

          <div className="space-y-1">
            {visibleSuggestions.map((item) => (
              <button
                key={item}
                type="button"
                className="flex min-h-12 w-full items-center gap-3 border-b border-slate-100 px-2 text-start text-sm text-slate-700 hover:bg-slate-50"
              >
                <Sparkles className="h-4 w-4 shrink-0 text-[#5b3ff4]" />
                <span>{item}</span>
              </button>
            ))}
          </div>

          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {chips.map((chip, index) => (
              <button
                key={chip}
                type="button"
                className={
                  index === 0
                    ? 'inline-flex h-9 shrink-0 items-center gap-1 rounded-full border border-[#8b72ff] px-3 text-sm font-medium text-[#5b3ff4]'
                    : 'inline-flex h-9 shrink-0 items-center rounded-full border border-slate-200 px-3 text-sm text-slate-600'
                }
              >
                {index === 0 ? <Sparkles className="h-3.5 w-3.5" /> : null}
                {chip}
              </button>
            ))}
          </div>

          <form
            action={action}
            className="mt-4 rounded-[28px] border-2 border-slate-900 bg-white p-4"
          >
            {/* Visually hidden rather than a `FormField`: this box is the mock
                of the staff chat composer, and a visible label above it would
                stop the preview looking like the thing it is previewing. The
                name still has to reach a screen reader, so it is a real
                `<label>` and not a placeholder. */}
            <label htmlFor="helpdesk-preview-question" className="sr-only">
              Ask the staff assistant a question
            </label>
            <textarea
              id="helpdesk-preview-question"
              name="question"
              rows={3}
              className="w-full resize-none border-0 bg-transparent text-sm outline-none placeholder:text-slate-400"
              placeholder="Ask the assistant anything..."
              defaultValue={state.question ?? ''}
            />
            <div className="mt-2 flex items-center justify-between">
              <button
                type="button"
                className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 text-slate-600"
                aria-label="Voice input"
                title="Voice input"
              >
                <Mic className="h-4 w-4" />
              </button>
              <AskButton />
            </div>
          </form>

          <p className="mt-3 text-center text-xs text-slate-500">
            The assistant can make mistakes. Double-check live software actions.
          </p>
        </div>
      </div>

      {/*
        EVERYTHING FROM HERE IS DASHBOARD CHROME, NOT THE MOCK.
        The panel on the left is a deliberate fixed-light picture of the staff
        chat as it appears inside the customer's own software, with that
        product's violet — the same exception the sidebar gradient takes. This
        column is not: it is an explanatory card and the assistant's answer,
        read by the owner in whichever theme they chose. It was painted in the
        mock's colours anyway (`bg-white`, `text-slate-950`, `text-slate-600`,
        `border-red-200`), so in dark mode half of this screen stayed white.
      */}
      <div className="space-y-4">
        <div className="rounded-lg border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Internal helpdesk brain</h2>
              <p className="text-sm text-muted-foreground">
                Built for staff inside your software, not as a public website bubble.
              </p>
            </div>
          </div>
          <div className={cn(CHOICE_GRID, 'mt-5 gap-3')}>
            <div className="rounded-md border p-3">
              <Search className="h-4 w-4 text-primary" />
              <p className="mt-2 text-sm font-medium">Reads reviewed docs</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Menus, screens, steps, fields, errors, and SOPs become searchable answers.
              </p>
            </div>
            <div className="rounded-md border p-3">
              <Wrench className="h-4 w-4 text-primary" />
              <p className="mt-2 text-sm font-medium">Runs approved actions</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Only enabled connector actions are callable, with confirmation for risky updates.
              </p>
            </div>
            <div className="rounded-md border p-3">
              <Boxes className="h-4 w-4 text-primary" />
              <p className="mt-2 text-sm font-medium">Keeps live data local</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Stock, reports, customers, and invoices are read through the customer connector.
              </p>
            </div>
            <div className="rounded-md border p-3">
              <Clock3 className="h-4 w-4 text-primary" />
              <p className="mt-2 text-sm font-medium">Polls for work</p>
              <p className="mt-1 text-xs text-muted-foreground">
                The connector claims queued events, executes locally, then posts the result back.
              </p>
            </div>
          </div>
        </div>

        {/* Raw `red-200/50/700` — undefined in dark mode, and a bare div with
            no live region, so a failed answer appeared silently. `FormMessage`
            is the announced version and `Alert` would not be: this is the
            result of pressing the button, not a standing notice. */}
        <FormMessage state={{ error: state.error }} className="text-sm" />
        {state.answer ? (
          <div className="rounded-lg border bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Assistant answered
            </p>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">
              {state.answer}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
