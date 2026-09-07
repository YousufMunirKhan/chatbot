'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { BOT_TYPES } from '@/lib/constants';
import { companyLabel } from '@/lib/labels';
import type { ActionState } from '../actions';
import type { BotRow } from '../data';
import { FormField } from '@/components/ui/form-field';
import { Select } from '@/components/ui/select';

const initial: ActionState = {};

/**
 * What each option gives the customer.
 *
 * These descriptions used to list *implementation prerequisites* — "Connected
 * catalogue or uploaded product CSV/API", "Write permission, confirmation,
 * audit trail". A shop owner deciding whether to tick a box needs to know what
 * they get, not what the engineer needs. Missing prerequisites are already
 * reported, in context, by the readiness checks on the Setup page.
 */
const CUSTOMER_CAPABILITIES = [
  {
    key: 'sales_agent',
    label: 'Recommend products and services',
    data: 'Suggests the right thing for what the customer describes, and explains why it suits them.',
  },
  {
    key: 'appointment_booking',
    label: 'Take bookings',
    data: 'Offers the times you are open and books the customer in without you being there.',
  },
  {
    key: 'lead_capture',
    label: 'Collect enquiries',
    data: 'Gets the name and contact details of interested visitors so you can follow up.',
  },
  {
    key: 'help_desk',
    label: 'Answer support questions',
    data: 'Handles the questions you answer every day: delivery, returns, opening hours, policies.',
  },
  {
    key: 'product_stock_assistant',
    label: 'Answer price and stock questions',
    data: 'Gives current prices and tells customers when something is out of stock.',
  },
  {
    key: 'order_tracking',
    label: 'Track orders',
    data: 'Tells a customer where their order is, once they have confirmed who they are.',
  },
  {
    key: 'order_placement',
    label: 'Place orders',
    data: 'Takes an order from start to finish and confirms it back to the customer.',
  },
  {
    key: 'human_agent_takeover',
    label: 'Pass the chat to a person',
    data: 'Stops answering and alerts your team when a customer needs a real person.',
  },
  {
    key: 'live_chat',
    label: 'Let your team reply live',
    data: 'Your team can step into any conversation and type back themselves.',
  },
] as const;

const INTERNAL_CAPABILITIES = [
  {
    key: 'internal_process_guide',
    label: 'Explain how your business does things',
    data: 'Answers "how do I do this" for your staff, so they stop asking you the same things.',
  },
  {
    key: 'internal_products_read',
    label: 'Look up products and prices',
    data: 'Your team can ask what something costs instead of digging through the system.',
  },
  {
    key: 'internal_stock_read',
    label: 'Check stock levels',
    data: 'Tells your team how many are left and where they are.',
  },
  {
    key: 'internal_stock_update',
    label: 'Update stock, with confirmation',
    data: 'Changes stock numbers for your team, but always asks them to confirm first.',
  },
  {
    key: 'internal_orders_read',
    label: 'Find orders',
    data: 'Pulls up an order and its progress while your team is on the phone.',
  },
  {
    key: 'internal_customers_read',
    label: 'Find customer records',
    data: 'Brings up a customer’s history, following the privacy rules you set.',
  },
  {
    key: 'internal_leads_read',
    label: 'Review enquiries and bookings',
    data: 'Shows your team what came in today and what still needs following up.',
  },
] as const;

// A brand-new assistant starts with support answers only. Pre-checking five
// capabilities made day one open with eleven failing readiness checks, so the
// rest are opt-in. Existing bots keep whatever they were saved with.
const DEFAULT_CUSTOMER_CAPABILITIES = new Set(['help_desk']);

type ActionFn = (prev: ActionState, formData: FormData) => Promise<ActionState>;

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : label}
    </Button>
  );
}

export function BotForm({
  action,
  bot,
  companyName,
  /** Host(s) derived from the company website, used to seed a new bot only. */
  suggestedDomains,
  submitLabel,
}: {
  action: ActionFn;
  bot?: BotRow;
  companyName?: string;
  suggestedDomains?: string[];
  submitLabel: string;
}) {
  const [state, formAction] = useFormState(action, initial);
  const appearance = (bot?.appearance ?? {}) as Record<string, unknown>;
  const initialAudience =
    bot?.assistantAudience ??
    (appearance.assistantAudience === 'internal' ? 'internal' : 'customer');
  const [assistantAudience, setAssistantAudience] = useState<'customer' | 'internal'>(
    initialAudience,
  );
  const assistantNameFallback =
    assistantAudience === 'internal'
      ? `${companyName ?? 'Internal'} Help Desk`
      : `${companyName ?? 'Website'} Assistant`;
  const capabilityOptions =
    assistantAudience === 'internal' ? INTERNAL_CAPABILITIES : CUSTOMER_CAPABILITIES;
  const customerBotType =
    bot?.botType === 'help_desk'
      ? 'hybrid_business_assistant'
      : (bot?.botType ?? 'hybrid_business_assistant');
  const enableDefaultPills = appearance.enableDefaultPills !== false;
  const enableContextualPills = appearance.enableContextualPills !== false;
  const enableConnectorGeneratedPills = appearance.enableConnectorGeneratedPills !== false;
  const isNewCustomerBot = !bot && assistantAudience === 'customer';
  const domainAllowlistDefault = bot
    ? (bot.domainAllowlist ?? []).join('\n')
    : (suggestedDomains ?? []).join('\n');

  useEffect(() => {
    setAssistantAudience(initialAudience);
  }, [bot?.id, initialAudience]);

  return (
    <form action={formAction} className="space-y-8">
      {bot ? <input type="hidden" name="botId" value={bot.id} /> : null}

      <section className="space-y-4">
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Who is it for
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex cursor-pointer gap-3 rounded-md border p-4 text-sm">
              <input
                type="radio"
                name="assistantAudience"
                value="customer"
                checked={assistantAudience === 'customer'}
                onChange={() => setAssistantAudience('customer')}
                className="mt-1 h-4 w-4"
              />
              <span>
                <span className="block font-medium">Your customers</span>
                <span className="mt-1 block text-muted-foreground">
                  Goes on your website. Answers questions, takes enquiries and bookings, and passes
                  the chat to a person when it needs to.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer gap-3 rounded-md border p-4 text-sm">
              <input
                type="radio"
                name="assistantAudience"
                value="internal"
                checked={assistantAudience === 'internal'}
                onChange={() => setAssistantAudience('internal')}
                className="mt-1 h-4 w-4"
              />
              <span>
                <span className="block font-medium">Your team</span>
                <span className="mt-1 block text-muted-foreground">
                  Stays inside your business. Answers your staff’s how-to questions and looks things
                  up in your shop system for them.
                </span>
              </span>
            </label>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* The asterisk was doing the job `FormField`'s `required` prop
              already does — and doing it only visually, so a screen reader
              heard "Assistant name star". */}
          <FormField
            label="Assistant name"
            htmlFor="name"
            required
            hint="Customers see this at the top of the chat, so use something they will recognise."
          >
            <Input
              name="name"
              required
              defaultValue={bot?.name ?? assistantNameFallback}
              placeholder={assistantNameFallback}
            />
          </FormField>
          {assistantAudience === 'internal' ? (
            // Not a control at all — a staff assistant has exactly one type, so
            // this states it. It used to be a bare `<Label>` with no `htmlFor`,
            // which renders a `<label>` element pointing at nothing.
            <div className="space-y-1.5">
              <input type="hidden" name="botType" value="help_desk" />
              <p className="text-sm font-medium leading-none">Type</p>
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm font-medium">
                Staff assistant
              </div>
              <p className="text-xs text-muted-foreground">
                Answers from what you have approved, and never from anything your customers can see.
              </p>
            </div>
          ) : (
            // The explanation moved into `hint`: a second child made `FormField`
            // skip its cloning step entirely, so the select got no `id` and the
            // label above it was associated with nothing.
            <FormField
              label="Type"
              htmlFor="botType"
              hint="This sets its general style. What it can help with is up to you, below."
            >
              <Select key="customer-bot-type" name="botType" defaultValue={customerBotType}>
                {BOT_TYPES.filter((t) => t !== 'help_desk').map((t) => (
                  <option key={t} value={t}>
                    {companyLabel('botType', t)}
                  </option>
                ))}
              </Select>
            </FormField>
          )}
          {/* The other half of the "Default language" collision: this is
              `bots.language_default`, which decides what language the assistant
              answers a customer in. The company profile's field of the same
              name decides what language the dashboard is in. Both labels now
              name their own subject. Unlike the dashboard one, `auto` here is
              real — the reply language follows whatever the customer wrote. */}
          <FormField
            label="Language it answers in"
            htmlFor="languageDefault"
            hint="Auto-detect replies in whatever language the customer wrote in, which is what most shops want. Pick one to answer in that language whatever they use."
          >
            <Select name="languageDefault" defaultValue={bot?.languageDefault ?? 'auto'}>
              <option value="auto">Auto-detect — match the customer</option>
              <option value="en">Always English</option>
              <option value="ar">Always Arabic</option>
            </Select>
          </FormField>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          What it can help with
        </h2>
        {isNewCustomerBot ? (
          <p className="text-sm text-muted-foreground">
            Your first assistant starts with support answers, because that only needs the questions
            and policies you already have. Turn the others on when you are ready — each one asks you
            for a few business details first.
          </p>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-2">
          {capabilityOptions.map((cap) => (
            <label key={cap.key} className="flex items-start gap-2 rounded-md border p-2.5 text-sm">
              <input
                type="checkbox"
                name="capabilities"
                value={cap.key}
                defaultChecked={
                  bot
                    ? bot.capabilityFlags?.includes(cap.key)
                    : assistantAudience === 'customer' && DEFAULT_CUSTOMER_CAPABILITIES.has(cap.key)
                }
                className="mt-0.5 h-4 w-4"
              />
              <span>
                <span className="block font-medium">{cap.label}</span>
                <span className="block text-xs text-muted-foreground">{cap.data}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">What you need to add</p>
          <p className="mt-1">
            Each thing you tick needs some business details behind it. Add them under Your business
            details. For a staff assistant, upload your own guides and notes so your team can ask
            where to find something and how to do it. It answers from what you give it, and says so
            when it does not know.
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Suggested questions
        </h2>
        <p className="text-sm text-muted-foreground">
          The one-tap buttons people see in the chat, so they do not have to think of what to ask.
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
            <input type="hidden" name="enableDefaultPills" value="off" />
            <input
              type="checkbox"
              name="enableDefaultPills"
              defaultChecked={enableDefaultPills}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              <span className="block font-medium">Starter questions</span>
              <span className="block text-xs text-muted-foreground">
                A few sensible questions to show before anyone has typed anything.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
            <input type="hidden" name="enableContextualPills" value="off" />
            <input
              type="checkbox"
              name="enableContextualPills"
              defaultChecked={enableContextualPills}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              <span className="block font-medium">Follow-up questions</span>
              <span className="block text-xs text-muted-foreground">
                Suggests what to ask next, based on what has been said so far.
              </span>
            </span>
          </label>
          {/* This one only ever applies to a staff assistant — it suggests
              questions about screens found in the company's own software, which
              a customer assistant never sees. It used to render for a customer
              assistant too, greyed out with nothing saying why. The hidden
              "off" is what the action already stored for it in that case, so
              nothing about the saved value changes. */}
          {assistantAudience === 'internal' ? (
            <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
              <input type="hidden" name="enableConnectorGeneratedPills" value="off" />
              <input
                type="checkbox"
                name="enableConnectorGeneratedPills"
                defaultChecked={enableConnectorGeneratedPills}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                <span className="block font-medium">Questions from your shop system</span>
                <span className="block text-xs text-muted-foreground">
                  Suggests questions about the screens and tasks it found in your own software.
                </span>
              </span>
            </label>
          ) : (
            <input type="hidden" name="enableConnectorGeneratedPills" value="off" />
          )}
        </div>
      </section>

      {assistantAudience === 'internal' ? (
        <section className="space-y-4">
          <input type="hidden" name="domainAllowlist" value="" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            The link to your shop system
          </h2>
          <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">
              A staff assistant does not go on your website
            </p>
            <p className="mt-1">
              You link it to your own shop system instead. Once linked, it can read your screens and
              run the tasks you have approved, so your team can just ask for what they need.
            </p>
            {bot ? (
              <Link
                href="/company/help-desk"
                className="mt-2 inline-block text-primary hover:underline"
              >
                Set up the link
              </Link>
            ) : null}
          </div>
        </section>
      ) : (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Your website
          </h2>
          {/* Second `FormField` here with two children — the textarea got no
              `id`, so "Website addresses it can appear on" labelled nothing. */}
          <FormField
            label="Website addresses it can appear on"
            htmlFor="domainAllowlist"
            hint={
              'One address per line, without https:// — acme.com, not https://acme.com/shop. The chat only shows up on these.' +
              (isNewCustomerBot && domainAllowlistDefault
                ? ' Filled in from your company website — edit it if the widget goes somewhere else.'
                : '')
            }
          >
            <Textarea
              name="domainAllowlist"
              defaultValue={domainAllowlistDefault}
              placeholder={'acme.com\nwww.acme.com'}
              rows={3}
            />
          </FormField>
          <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">
              Widget look &amp; feel lives in the Design Studio
            </p>
            <p className="mt-1">
              Colors, launcher, avatar, labels, sizing, and placement are designed with a live
              preview on the{' '}
              {bot ? (
                <Link href="/company/widget" className="text-primary hover:underline">
                  Website Widget page
                </Link>
              ) : (
                <span className="font-medium text-foreground">Website Widget page</span>
              )}
              {bot ? '.' : ' (available once this assistant is created).'} Saving here never changes
              that design.
            </p>
          </div>
        </section>
      )}

      {bot ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="aiEnabled"
            defaultChecked={bot.aiEnabled}
            className="h-4 w-4"
          />
          Let this assistant reply on its own
        </label>
      ) : null}

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-emerald-600">Saved.</p> : null}
      <SubmitButton label={submitLabel} />
    </form>
  );
}
