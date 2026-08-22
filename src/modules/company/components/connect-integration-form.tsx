'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { connectIntegrationAction } from '../integrations-actions';
import type { ActionState } from '../actions';
import { TIMEZONE_OPTIONS } from '../form-options';
import { FormField } from '@/components/ui/form-field';
import { Select } from '@/components/ui/select';

const initial: ActionState = {};

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
        <FormField label="Provider" htmlFor="provider">
          <Select name="provider" value={provider} onChange={(event) => setProvider(event.target.value as Provider)}>
            <option value="woocommerce">WordPress / WooCommerce</option>
            <option value="shopify">Shopify store</option>
            <option value="custom_api">Custom API</option>
            <option value="google_calendar">Google Calendar</option>
          </Select>
          <p className="text-xs text-muted-foreground">{PROVIDER_HELP[provider]}</p>
        </FormField>
        <FormField label="Connection name *" htmlFor="name">
          <Input name="name" required placeholder="My store" />
        </FormField>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {provider === 'woocommerce' ? (
          <>
            <FormField label="WordPress store URL" htmlFor="base_url">
              <Input name="base_url" type="url" placeholder="https://yourwordpressstore.com" />
            </FormField>
            <FormField label="Consumer key" htmlFor="consumer_key">
              <Input name="consumer_key" placeholder="ck_..." />
            </FormField>
            <FormField label="Consumer secret" htmlFor="consumer_secret">
              <Input name="consumer_secret" type="password" placeholder="cs_..." />
            </FormField>
            <FormField label="Default currency" htmlFor="currency">
              <Input name="currency" placeholder="USD" maxLength={3} />
            </FormField>
          </>
        ) : null}
        {provider === 'shopify' ? (
          <>
            <FormField label="Shop domain" htmlFor="shop">
              <Input name="shop" placeholder="your-store.myshopify.com" />
            </FormField>
            <FormField label="Admin API access token" htmlFor="access_token">
              <Input name="access_token" type="password" placeholder="shpat_..." />
            </FormField>
            <FormField label="API version" htmlFor="api_version">
              <Input name="api_version" placeholder="2024-01" />
            </FormField>
            <FormField label="Default currency" htmlFor="currency">
              <Input name="currency" placeholder="USD" maxLength={3} />
            </FormField>
          </>
        ) : null}
        {provider === 'google_calendar' ? (
          <>
            <FormField label="Calendar" htmlFor="calendar_id">
              <Input name="calendar_id" placeholder="primary or calendar ID" />
            </FormField>
            <FormField label="Calendar timezone" htmlFor="timezone">
              <Select name="timezone" defaultValue="Europe/London">
                {TIMEZONE_OPTIONS.map((timezone) => (
                  <option key={timezone} value={timezone}>
                    {timezone}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Access token" htmlFor="access_token">
              <Input name="access_token" type="password" />
            </FormField>
          </>
        ) : null}
        {provider === 'custom_api' ? (
          <>
            <FormField label="API base URL" htmlFor="base_url">
              <Input name="base_url" type="url" placeholder="https://api.example.com" />
            </FormField>
            <FormField label="API token" htmlFor="token">
              <Input name="token" type="password" />
            </FormField>
            <FormField label="Products path" htmlFor="products_path">
              <Input name="products_path" placeholder="/products" />
            </FormField>
            <FormField label="Inventory path" htmlFor="inventory_path">
              <Input name="inventory_path" placeholder="/inventory" />
            </FormField>
            <FormField label="Orders path" htmlFor="orders_path">
              <Input name="orders_path" placeholder="/orders" />
            </FormField>
            <FormField label="Customers path" htmlFor="customers_path">
              <Input name="customers_path" placeholder="/customers" />
            </FormField>
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
          <FormField label="Extra key" htmlFor="extra_key">
            <Input name="extra_key" />
          </FormField>
          <FormField label="Extra secret" htmlFor="extra_secret">
            <Input name="extra_secret" type="password" />
          </FormField>
        </div>
      </details>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-emerald-600">Integration connected.</p> : null}
      <Submit />
    </form>
  );
}
