'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { connectIntegrationAction } from '../integrations-actions';
import type { ActionState } from '../actions';
import { TIMEZONE_OPTIONS } from '../form-options';

const initial: ActionState = {};
const selectCls =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

type Provider = 'woocommerce' | 'shopify' | 'custom_api' | 'google_calendar';

const PROVIDER_HELP: Record<Provider, string> = {
  woocommerce: 'Connect a WordPress shop that uses WooCommerce. This syncs products, prices, stock, customers, and orders.',
  shopify: 'Connect a Shopify store with an Admin API access token. This syncs products, inventory, customers, and orders.',
  custom_api: 'Use this for .NET, Android/POS, ERP, CRM, or any custom system that can expose the required API endpoints.',
  google_calendar: 'Use this only for appointment availability and calendar booking support.',
};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Connecting…' : 'Connect'}
    </Button>
  );
}

export function ConnectIntegrationForm() {
  const [state, action] = useFormState(connectIntegrationAction, initial);
  const [provider, setProvider] = useState<Provider>('woocommerce');

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="provider">Provider</Label>
          <select id="provider" name="provider" className={selectCls} value={provider} onChange={(event) => setProvider(event.target.value as Provider)}>
            <option value="woocommerce">WordPress / WooCommerce</option>
            <option value="shopify">Shopify store</option>
            <option value="custom_api">Custom API</option>
            <option value="google_calendar">Google Calendar</option>
          </select>
          <p className="text-xs text-muted-foreground">{PROVIDER_HELP[provider]}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="name">Connection name *</Label>
          <Input id="name" name="name" required placeholder="My store" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {provider === 'woocommerce' ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="base_url">WordPress store URL</Label>
              <Input id="base_url" name="base_url" type="url" placeholder="https://yourwordpressstore.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="consumer_key">Consumer key</Label>
              <Input id="consumer_key" name="consumer_key" placeholder="ck_..." />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="consumer_secret">Consumer secret</Label>
              <Input id="consumer_secret" name="consumer_secret" type="password" placeholder="cs_..." />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="currency">Default currency</Label>
              <Input id="currency" name="currency" placeholder="USD" maxLength={3} />
            </div>
          </>
        ) : null}
        {provider === 'shopify' ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="shop">Shop domain</Label>
              <Input id="shop" name="shop" placeholder="your-store.myshopify.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="access_token">Admin API access token</Label>
              <Input id="access_token" name="access_token" type="password" placeholder="shpat_..." />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="api_version">API version</Label>
              <Input id="api_version" name="api_version" placeholder="2024-01" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="currency">Default currency</Label>
              <Input id="currency" name="currency" placeholder="USD" maxLength={3} />
            </div>
          </>
        ) : null}
        {provider === 'google_calendar' ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="calendar_id">Calendar</Label>
              <Input id="calendar_id" name="calendar_id" placeholder="primary or calendar ID" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="timezone">Calendar timezone</Label>
              <select id="timezone" name="timezone" className={selectCls} defaultValue="Europe/London">
                {TIMEZONE_OPTIONS.map((timezone) => (
                  <option key={timezone} value={timezone}>
                    {timezone}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="access_token">Access token</Label>
              <Input id="access_token" name="access_token" type="password" />
            </div>
          </>
        ) : null}
        {provider === 'custom_api' ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="base_url">API base URL</Label>
              <Input id="base_url" name="base_url" type="url" placeholder="https://api.example.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="token">API token</Label>
              <Input id="token" name="token" type="password" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="products_path">Products path</Label>
              <Input id="products_path" name="products_path" placeholder="/products" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inventory_path">Inventory path</Label>
              <Input id="inventory_path" name="inventory_path" placeholder="/inventory" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="orders_path">Orders path</Label>
              <Input id="orders_path" name="orders_path" placeholder="/orders" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="customers_path">Customers path</Label>
              <Input id="customers_path" name="customers_path" placeholder="/customers" />
            </div>
          </>
        ) : null}
      </div>

      {provider === 'custom_api' ? (
        <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
          Custom API should return JSON arrays or objects with products, inventory, orders, and
          customers keys. See <a className="text-primary underline" href="/api/integrations/custom/schema" target="_blank">the schema</a>.
        </div>
      ) : null}

      <details className="rounded-md border p-3">
        <summary className="cursor-pointer text-sm font-medium">Advanced credentials</summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="extra_key">Extra key</Label>
            <Input id="extra_key" name="extra_key" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="extra_secret">Extra secret</Label>
            <Input id="extra_secret" name="extra_secret" type="password" />
          </div>
        </div>
      </details>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-emerald-600">Integration connected.</p> : null}
      <Submit />
    </form>
  );
}
