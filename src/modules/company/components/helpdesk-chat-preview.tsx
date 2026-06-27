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
import { testAssistantAction, type TestAssistantState } from '../test-assistant-actions';

const initial: TestAssistantState = {};

const suggestions = [
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
      aria-label="Ask Switch&Save"
      title="Ask Switch&Save"
    >
      {pending ? <Sparkles className="h-4 w-4 animate-pulse" /> : <ArrowRight className="h-4 w-4" />}
    </Button>
  );
}

export function HelpdeskChatPreview() {
  const [state, action] = useFormState(testAssistantAction, initial);

  return (
    <section className="grid gap-6 lg:grid-cols-[minmax(320px,0.95fr)_1.05fr]">
      <div className="overflow-hidden rounded-lg border bg-white shadow-sm">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div className="inline-flex rounded-full bg-slate-100 p-1 text-sm font-medium">
            <button className="rounded-full bg-white px-4 py-2 text-slate-950 shadow-sm" type="button">
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
            <p className="mt-2 text-base text-slate-600">How can Switch&amp;Save help you today?</p>
          </div>

          <div className="space-y-1">
            {suggestions.map((item) => (
              <button
                key={item}
                type="button"
                className="flex min-h-12 w-full items-center gap-3 border-b border-slate-100 px-2 text-left text-sm text-slate-700 hover:bg-slate-50"
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

          <form action={action} className="mt-4 rounded-[28px] border-2 border-slate-900 bg-white p-4">
            <textarea
              name="question"
              rows={3}
              className="w-full resize-none border-0 bg-transparent text-sm outline-none placeholder:text-slate-400"
              placeholder="Ask Switch&Save anything..."
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
            Switch&amp;Save can make mistakes. Double-check live software actions.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-lg border bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-violet-50 text-[#5b3ff4]">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Switch&amp;Save helpdesk brain</h2>
              <p className="text-sm text-slate-600">
                Built for staff inside your software, not as a public website bubble.
              </p>
            </div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border p-3">
              <Search className="h-4 w-4 text-[#5b3ff4]" />
              <p className="mt-2 text-sm font-medium">Reads reviewed docs</p>
              <p className="mt-1 text-xs text-slate-500">
                Menus, screens, steps, fields, errors, and SOPs become searchable answers.
              </p>
            </div>
            <div className="rounded-md border p-3">
              <Wrench className="h-4 w-4 text-[#5b3ff4]" />
              <p className="mt-2 text-sm font-medium">Runs approved actions</p>
              <p className="mt-1 text-xs text-slate-500">
                Only enabled connector actions are callable, with confirmation for risky updates.
              </p>
            </div>
            <div className="rounded-md border p-3">
              <Boxes className="h-4 w-4 text-[#5b3ff4]" />
              <p className="mt-2 text-sm font-medium">Keeps live data local</p>
              <p className="mt-1 text-xs text-slate-500">
                Stock, reports, customers, and invoices are read through the customer connector.
              </p>
            </div>
            <div className="rounded-md border p-3">
              <Clock3 className="h-4 w-4 text-[#5b3ff4]" />
              <p className="mt-2 text-sm font-medium">Polls for work</p>
              <p className="mt-1 text-xs text-slate-500">
                The connector claims queued events, executes locally, then posts the result back.
              </p>
            </div>
          </div>
        </div>

        {state.error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {state.error}
          </div>
        ) : null}
        {state.answer ? (
          <div className="rounded-lg border bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Switch&amp;Save answered
            </p>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{state.answer}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
