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
  woocommerce:
    'Connect a WordPress shop that uses WooCommerce. This syncs products, prices, stock, customers, and orders.',
  shopify:
    'Connect a Shopify store with an Admin API access token. This syncs products, inventory, customers, and orders.',
  custom_api:
    'Use this for .NET, Android/POS, ERP, CRM, or any custom system that can expose the required API endpoints.',
  google_calendar: 'Use this only for appointment availability and calendar booking support.',
};

/**
 * Show an IANA timezone id as a place name.
 *
 * The id itself is what the server stores and what Google Calendar is queried
 * with, so the `value` submitted stays byte-identical — only the text a person
 * reads changes: `America/New_York` → "New York (America/New_York)". The id is
 * kept in the text as well because a shop that was told a specific id by its
 * calendar admin needs to be able to find it in the list.
 *
 * Deliberately duplicated in `profile-form.tsx` rather than shared: the list it
 * formats (`TIMEZONE_OPTIONS`) lives in a module this change does not own.
 */
function timezoneLabel(id: string): string {
  const place = id.split('/').pop()?.replace(/_/g, ' ') ?? id;
  return `${place} (${id})`;
}

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
          <Select
            name="provider"
            value={provider}
            onChange={(event) => setProvider(event.target.value as Provider)}
          >
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
            <FormField
              label="Default currency"
              htmlFor="currency"
              hint="The three-letter code your shop prices in — USD, GBP, EUR, AED. Prices we read from your shop are shown in this currency."
            >
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
            <FormField
              label="Shopify API version"
              htmlFor="api_version"
              hint="A date, like 2024-01. In your Shopify admin it is on the app you created the token for, under Settings → Apps and sales channels → Develop apps → API credentials. Leave it empty if you are not sure — we then use 2024-01."
            >
              <Input name="api_version" placeholder="2024-01" />
            </FormField>
            <FormField
              label="Default currency"
              htmlFor="currency"
              hint="The three-letter code your shop prices in — USD, GBP, EUR, AED. Prices we read from your shop are shown in this currency."
            >
              <Input name="currency" placeholder="USD" maxLength={3} />
            </FormField>
          </>
        ) : null}
        {provider === 'google_calendar' ? (
          <>
            <FormField label="Calendar" htmlFor="calendar_id">
              <Input name="calendar_id" placeholder="primary or calendar ID" />
            </FormField>
            <FormField
              label="Calendar timezone"
              htmlFor="timezone"
              hint="The times your customers are offered are worked out in this zone. Use the one your calendar is set to."
            >
              <Select name="timezone" defaultValue="Europe/London">
                {TIMEZONE_OPTIONS.map((timezone) => (
                  <option key={timezone} value={timezone}>
                    {timezoneLabel(timezone)}
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
          customers keys. See{' '}
          <a
            className="text-primary underline"
            href="/api/integrations/custom/schema"
            target="_blank"
          >
            the schema
          </a>
          .
        </div>
      ) : null}

      <details className="rounded-md border p-3">
        <summary className="cursor-pointer text-sm font-medium">Advanced credentials</summary>
        {/* These two are a passthrough: whatever is typed is stored in the
            encrypted credentials blob under the same names, and nothing reads
            them unless a specific setup asks for them. Saying "most shops leave
            these empty" is the honest instruction — an owner filling in every
            box they can see is the failure this panel invited. */}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <FormField
            label="Extra key"
            htmlFor="extra_key"
            hint="Only needed if the system you are connecting asked you for a second credential. Most shops leave this empty."
          >
            <Input name="extra_key" />
          </FormField>
          <FormField
            label="Extra secret"
            htmlFor="extra_secret"
            hint="The password that goes with the extra key above. Stored encrypted, and never shown again. Most shops leave this empty."
          >
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
