'use client';

import { useState } from 'react';
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

const COLOR_PRESETS = ['#2563eb', '#16a34a', '#0891b2', '#7c3aed', '#dc2626', '#111827'];
const DEFAULT_CUSTOMER_CAPABILITIES = new Set([
  'sales_agent',
  'appointment_booking',
  'lead_capture',
  'help_desk',
  'human_agent_takeover',
]);

const CUSTOMER_DEFAULTS = {
  name: 'Switch & Save Assistant',
  title: 'Switch & Save Assistant',
  welcomeMessage:
    'Hi, I can help with EPOS systems, card machines, pricing, demos, and support. What would you like to sort out today?',
  agentLabel: 'Julie',
  onlineLabel: 'Julie is replying - live',
  offlineLabel: 'Replying soon',
  typingLabel: 'Julie is typing',
  footerBranding:
    'AI assistant may be inaccurate. We may use messages and contact details to respond to your enquiry.',
  proactiveMessage: 'Need help choosing the right EPOS or card machine? I can guide you in under a minute.',
  primaryColor: '#045fff',
};

const INTERNAL_DEFAULTS = {
  name: 'Internal Help Desk Assistant',
  title: 'Internal Help Desk',
  welcomeMessage:
    'Hi, I can guide your team through project notes, stock, orders, customers, and safe updates.',
  agentLabel: 'Help Desk',
  onlineLabel: 'Ready for staff questions',
  offlineLabel: 'Available when your team needs help',
  typingLabel: 'Checking internal knowledge',
  footerBranding: 'Internal assistant. Check important actions before applying changes.',
  proactiveMessage: 'Ask me how this project works or where to update something.',
  primaryColor: '#2563eb',
};

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function readNonEmptyString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function safeColor(value: unknown): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : '#2563eb';
}

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
  submitLabel,
}: {
  action: ActionFn;
  bot?: BotRow;
  submitLabel: string;
}) {
  const [state, formAction] = useFormState(action, initial);
  const appearance = (bot?.appearance ?? {}) as Record<string, unknown>;
  const initialAudience = appearance.assistantAudience === 'internal' ? 'internal' : 'customer';
  const [assistantAudience, setAssistantAudience] = useState<'customer' | 'internal'>(
    initialAudience,
  );
  const copyDefaults = assistantAudience === 'internal' ? INTERNAL_DEFAULTS : CUSTOMER_DEFAULTS;
  const capabilityOptions =
    assistantAudience === 'internal' ? INTERNAL_CAPABILITIES : CUSTOMER_CAPABILITIES;
  const [primaryColor, setPrimaryColor] = useState(
    safeColor(readNonEmptyString(appearance.primaryColor, copyDefaults.primaryColor)),
  );
  const autoOpenDelay = readNumber(appearance.autoOpenDelaySeconds, 3);
  const bottomOffset = readNumber(appearance.bottomOffset, 20);
  const sideOffset = readNumber(appearance.sideOffset, 20);
  const zIndex = readNumber(appearance.zIndex, 2147483000);

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
              defaultValue={bot?.name ?? ''}
              placeholder={copyDefaults.name}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="botType">Type</Label>
            <select
              id="botType"
              name="botType"
              className={selectCls}
              defaultValue={bot?.botType ?? 'hybrid_business_assistant'}
            >
              {BOT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {BOT_TYPE_LABELS[t] ?? t}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              This controls the base style; capabilities below decide what it can actually do.
            </p>
          </div>
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

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Widget appearance
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="title">Widget title</Label>
            <Input
              id="title"
              name="title"
              defaultValue={readNonEmptyString(appearance.title, bot?.name ?? copyDefaults.title)}
              placeholder={copyDefaults.title}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="welcomeMessage">Welcome message</Label>
            <Input
              id="welcomeMessage"
              name="welcomeMessage"
              defaultValue={readNonEmptyString(appearance.welcomeMessage, copyDefaults.welcomeMessage)}
              placeholder={copyDefaults.welcomeMessage}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agentLabel">Agent label</Label>
            <Input
              id="agentLabel"
              name="agentLabel"
              defaultValue={readNonEmptyString(appearance.agentLabel, copyDefaults.agentLabel)}
              placeholder={copyDefaults.agentLabel}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agentAvatarUrl">Agent avatar image</Label>
            <Input
              id="agentAvatarUrl"
              name="agentAvatarUrl"
              type="url"
              defaultValue={readString(appearance.agentAvatarUrl)}
              placeholder="Optional image URL. If blank, the widget uses initials."
            />
            <p className="text-xs text-muted-foreground">
              Optional. Leave blank to show a clean initials avatar.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="launcherIcon">Launcher icon</Label>
            <select
              id="launcherIcon"
              name="launcherIcon"
              className={selectCls}
              defaultValue={(appearance.launcherIcon as string) ?? 'chat'}
            >
              <option value="chat">Chat</option>
              <option value="spark">Spark</option>
              <option value="help">Help</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="onlineLabel">Online label</Label>
            <Input
              id="onlineLabel"
              name="onlineLabel"
              defaultValue={readNonEmptyString(appearance.onlineLabel, copyDefaults.onlineLabel)}
              placeholder={copyDefaults.onlineLabel}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="offlineLabel">Offline label</Label>
            <Input
              id="offlineLabel"
              name="offlineLabel"
              defaultValue={readNonEmptyString(appearance.offlineLabel, copyDefaults.offlineLabel)}
              placeholder={copyDefaults.offlineLabel}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="typingLabel">Typing label</Label>
            <Input
              id="typingLabel"
              name="typingLabel"
              defaultValue={readNonEmptyString(appearance.typingLabel, copyDefaults.typingLabel)}
              placeholder={copyDefaults.typingLabel}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="footerBranding">Footer branding</Label>
            <Input
              id="footerBranding"
              name="footerBranding"
              defaultValue={readNonEmptyString(appearance.footerBranding, copyDefaults.footerBranding)}
              placeholder={copyDefaults.footerBranding}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="primaryColor">Primary color</Label>
            <div className="flex items-center gap-3 rounded-md border p-2">
              <input
                id="primaryColor"
                name="primaryColor"
                type="color"
                value={primaryColor}
                onChange={(event) => setPrimaryColor(event.target.value)}
                className="h-9 w-12 cursor-pointer rounded border bg-transparent p-1"
                aria-label="Primary color"
              />
              <Input
                value={primaryColor}
                readOnly
                aria-label="Selected primary color"
                className="font-mono"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {COLOR_PRESETS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setPrimaryColor(color)}
                  className="h-7 w-7 rounded-full border"
                  style={{ backgroundColor: color }}
                  aria-label={`Use ${color}`}
                  title={color}
                />
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="launcherStyle">Launcher style</Label>
            <select
              id="launcherStyle"
              name="launcherStyle"
              className={selectCls}
              defaultValue={(appearance.launcherStyle as string) ?? 'circle'}
            >
              <option value="circle">Circle</option>
              <option value="pill">Pill with label</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="launcherSize">Launcher size</Label>
            <select
              id="launcherSize"
              name="launcherSize"
              className={selectCls}
              defaultValue={(appearance.launcherSize as string) ?? 'default'}
            >
              <option value="compact">Compact</option>
              <option value="default">Default</option>
              <option value="large">Large</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="windowSize">Window size</Label>
            <select
              id="windowSize"
              name="windowSize"
              className={selectCls}
              defaultValue={(appearance.windowSize as string) ?? 'default'}
            >
              <option value="compact">Compact</option>
              <option value="default">Default</option>
              <option value="large">Large</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mobileMode">Mobile mode</Label>
            <select
              id="mobileMode"
              name="mobileMode"
              className={selectCls}
              defaultValue={(appearance.mobileMode as string) ?? 'fullscreen'}
            >
              <option value="fullscreen">Fullscreen</option>
              <option value="bottom_sheet">Bottom sheet</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="position">Position</Label>
            <select
              id="position"
              name="position"
              className={selectCls}
              defaultValue={(appearance.position as string) ?? 'right'}
            >
              <option value="right">Bottom right</option>
              <option value="left">Bottom left</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="domainAllowlist">Allowed website domains</Label>
            <Textarea
              id="domainAllowlist"
              name="domainAllowlist"
              defaultValue={(bot?.domainAllowlist ?? []).join('\n')}
              placeholder={'acme.com\nwww.acme.com'}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">One website domain per line.</p>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Widget behavior
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="proactiveMessage">Proactive message</Label>
            <Input
              id="proactiveMessage"
              name="proactiveMessage"
              defaultValue={readNonEmptyString(appearance.proactiveMessage, copyDefaults.proactiveMessage)}
              placeholder={copyDefaults.proactiveMessage}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="autoOpenDelaySeconds">Auto-open delay seconds</Label>
            <Input
              id="autoOpenDelaySeconds"
              name="autoOpenDelaySeconds"
              type="number"
              min={0}
              max={120}
              defaultValue={String(autoOpenDelay)}
            />
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex items-center gap-2 rounded-md border p-2.5 text-sm">
            <input
              type="checkbox"
              name="autoOpen"
              defaultChecked={Boolean(appearance.autoOpen)}
              className="h-4 w-4"
            />
            Auto-open chat
          </label>
          <label className="flex items-center gap-2 rounded-md border p-2.5 text-sm">
            <input
              type="checkbox"
              name="autoOpenOnce"
              defaultChecked={appearance.autoOpenOnce !== false}
              className="h-4 w-4"
            />
            Auto-open only once per visitor
          </label>
          <label className="flex items-center gap-2 rounded-md border p-2.5 text-sm">
            <input
              type="checkbox"
              name="showOnMobile"
              defaultChecked={appearance.showOnMobile !== false}
              className="h-4 w-4"
            />
            Show on mobile
          </label>
          <label className="flex items-center gap-2 rounded-md border p-2.5 text-sm">
            <input
              type="checkbox"
              name="showOnDesktop"
              defaultChecked={appearance.showOnDesktop !== false}
              className="h-4 w-4"
            />
            Show on desktop
          </label>
        </div>
        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Advanced placement settings
          </summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="bottomOffset">Bottom spacing</Label>
              <Input
                id="bottomOffset"
                name="bottomOffset"
                type="number"
                min={0}
                max={120}
                defaultValue={String(bottomOffset)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sideOffset">Side spacing</Label>
              <Input
                id="sideOffset"
                name="sideOffset"
                type="number"
                min={0}
                max={120}
                defaultValue={String(sideOffset)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="zIndex">Page layer</Label>
              <Input
                id="zIndex"
                name="zIndex"
                type="number"
                min={1000}
                defaultValue={String(zIndex)}
              />
            </div>
          </div>
        </details>
      </section>

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
