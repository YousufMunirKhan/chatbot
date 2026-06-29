'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { BOT_TYPES } from '@/lib/constants';
import type { ActionState } from '../actions';
import type { BotRow } from '../data';

const initial: ActionState = {};
const selectCls =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const BOT_TYPE_LABELS: Record<string, string> = {
  help_desk: 'Support-focused',
  sales_agent: 'Sales-focused',
  hybrid_business_assistant: 'Website assistant',
  informational: 'Information-only',
  custom: 'Custom',
};

const CUSTOMER_CAPABILITIES = [
  {
    key: 'sales_agent',
    label: 'Recommend products/services',
    data: 'Services, products, prices, best sellers, benefits',
  },
  {
    key: 'appointment_booking',
    label: 'Book appointments',
    data: 'Business hours, service area, booking rules, contact fields',
  },
  {
    key: 'lead_capture',
    label: 'Capture leads',
    data: 'Lead questions, contact fields, handoff rules',
  },
  {
    key: 'help_desk',
    label: 'Answer support questions',
    data: 'Policies, FAQs, delivery/returns/support information',
  },
  {
    key: 'product_stock_assistant',
    label: 'Answer product, price, and stock',
    data: 'Connected catalogue or uploaded product CSV/API',
  },
  {
    key: 'order_tracking',
    label: 'Track customer orders',
    data: 'Order integration and identity check rules',
  },
  {
    key: 'order_placement',
    label: 'Create customer orders',
    data: 'Catalogue, stock, order confirmation and fulfilment rules',
  },
  {
    key: 'human_agent_takeover',
    label: 'Hand off to human',
    data: 'When to pause AI and notify the team',
  },
  {
    key: 'live_chat',
    label: 'Allow live chat takeover',
    data: 'Team members and inbox coverage',
  },
] as const;

const INTERNAL_CAPABILITIES = [
  {
    key: 'internal_process_guide',
    label: 'Answer company/project how-to',
    data: 'Internal SOPs, project docs, admin guide, process notes, screenshots',
  },
  {
    key: 'internal_products_read',
    label: 'Search products/prices',
    data: 'Product catalogue integration or CSV',
  },
  {
    key: 'internal_stock_read',
    label: 'Check stock',
    data: 'Inventory sync with quantity/location',
  },
  {
    key: 'internal_stock_update',
    label: 'Update stock safely',
    data: 'Write permission, confirmation, audit trail',
  },
  {
    key: 'internal_orders_read',
    label: 'Find orders',
    data: 'Order integration and fulfilment status',
  },
  {
    key: 'internal_customers_read',
    label: 'Find customers',
    data: 'Customer records with privacy rules',
  },
  {
    key: 'internal_leads_read',
    label: 'Review leads/bookings',
    data: 'Lead and appointment capture enabled',
  },
] as const;

const DEFAULT_CUSTOMER_CAPABILITIES = new Set([
  'sales_agent',
  'appointment_booking',
  'lead_capture',
  'help_desk',
  'human_agent_takeover',
]);

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
  submitLabel,
}: {
  action: ActionFn;
  bot?: BotRow;
  companyName?: string;
  submitLabel: string;
}) {
  const [state, formAction] = useFormState(action, initial);
  const appearance = (bot?.appearance ?? {}) as Record<string, unknown>;
  const initialAudience = appearance.assistantAudience === 'internal' ? 'internal' : 'customer';
  const [assistantAudience, setAssistantAudience] = useState<'customer' | 'internal'>(
    initialAudience,
  );
  const assistantNameFallback =
    assistantAudience === 'internal'
      ? `${companyName ?? 'Internal'} Help Desk`
      : `${companyName ?? 'Website'} Assistant`;
  const capabilityOptions =
    assistantAudience === 'internal' ? INTERNAL_CAPABILITIES : CUSTOMER_CAPABILITIES;
  const customerBotType = bot?.botType === 'help_desk' ? 'hybrid_business_assistant' : (bot?.botType ?? 'hybrid_business_assistant');
  const enableDefaultPills = appearance.enableDefaultPills !== false;
  const enableContextualPills = appearance.enableContextualPills !== false;
  const enableConnectorGeneratedPills = appearance.enableConnectorGeneratedPills !== false;

  return (
    <form action={formAction} className="space-y-8">
      {bot ? <input type="hidden" name="botId" value={bot.id} /> : null}

      <section className="space-y-4">
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Assistant audience
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
                <span className="block font-medium">Customer-facing website assistant</span>
                <span className="mt-1 block text-muted-foreground">
                  For website visitors: sales, support, booking, leads, orders, and human handoff.
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
                <span className="block font-medium">Internal help desk assistant</span>
                <span className="mt-1 block text-muted-foreground">
                  For staff: answer company how-to questions, search products, check stock, review
                  records, and prepare safe updates.
                </span>
              </span>
            </label>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="name">Assistant name *</Label>
            <Input
              id="name"
              name="name"
              required
              defaultValue={bot?.name ?? assistantNameFallback}
              placeholder={assistantNameFallback}
            />
          </div>
          {assistantAudience === 'internal' ? (
            <div className="space-y-1.5">
              <input type="hidden" name="botType" value="help_desk" />
              <Label>Type</Label>
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm font-medium">
                Internal help desk
              </div>
              <p className="text-xs text-muted-foreground">
                Uses connector docs, approved internal knowledge, and staff-only safety rules.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="botType">Type</Label>
              <select
                key="customer-bot-type"
                id="botType"
                name="botType"
                className={selectCls}
                defaultValue={customerBotType}
              >
                {BOT_TYPES.filter((t) => t !== 'help_desk').map((t) => (
                  <option key={t} value={t}>
                    {BOT_TYPE_LABELS[t] ?? t}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                This controls the base style; capabilities below decide what it can actually do.
              </p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="languageDefault">Default language</Label>
            <select
              id="languageDefault"
              name="languageDefault"
              className={selectCls}
              defaultValue={bot?.languageDefault ?? 'auto'}
            >
              <option value="auto">Auto-detect</option>
              <option value="en">English</option>
              <option value="ar">Arabic</option>
            </select>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Capabilities
        </h2>
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
          <p className="font-medium text-foreground">Data needed for selected journey</p>
          <p className="mt-1">
            Add the matching data in Business Data, Knowledge, and Integrations. For internal help
            desk, upload SOPs, admin guides, project notes, and process docs so staff can ask where
            to go and how to update things. The assistant will answer from those facts and will say
            when something is missing.
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Quick pills
        </h2>
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
              <span className="block font-medium">Default pills</span>
              <span className="block text-xs text-muted-foreground">
                Seed safe starter buttons for this assistant.
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
              <span className="block font-medium">Contextual pills</span>
              <span className="block text-xs text-muted-foreground">
                Show relevant follow-ups from keywords/context.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
            <input type="hidden" name="enableConnectorGeneratedPills" value="off" />
            <input
              type="checkbox"
              name="enableConnectorGeneratedPills"
              defaultChecked={enableConnectorGeneratedPills}
              disabled={assistantAudience !== 'internal'}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              <span className="block font-medium">Connector pills</span>
              <span className="block text-xs text-muted-foreground">
                Generate helpdesk buttons from synced screens/actions.
              </span>
            </span>
          </label>
        </div>
      </section>

      {assistantAudience === 'internal' ? (
        <section className="space-y-4">
          <input type="hidden" name="domainAllowlist" value="" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Connector setup
          </h2>
          <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Help Desk does not use a public website widget</p>
            <p className="mt-1">
              Install a connector in the customer software instead. Connectors sync screens,
              approved actions, and route metadata so staff can ask questions and run safe actions
              from the internal Help Desk.
            </p>
            {bot ? (
              <Link href="/company/help-desk" className="mt-2 inline-block text-primary hover:underline">
                Open connector setup
              </Link>
            ) : null}
          </div>
        </section>
      ) : (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Website domains
          </h2>
          <div className="space-y-1.5">
            <Label htmlFor="domainAllowlist">Allowed website domains</Label>
            <Textarea
              id="domainAllowlist"
              name="domainAllowlist"
              defaultValue={(bot?.domainAllowlist ?? []).join('\n')}
              placeholder={'acme.com\nwww.acme.com'}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              One website domain per line. The widget only loads on these domains.
            </p>
          </div>
          <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Widget look &amp; feel lives in the Design Studio</p>
            <p className="mt-1">
              Colors, launcher, avatar, labels, sizing, and placement are designed with a live preview
              on the{' '}
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
          AI replies enabled
        </label>
      ) : null}

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-emerald-600">Saved.</p> : null}
      <SubmitButton label={submitLabel} />
    </form>
  );
}
