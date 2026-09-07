'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { connectIntegrationAction } from '../integrations-actions';
import type { ActionState } from '../actions';
import { TIMEZONE_OPTIONS } from '../form-options';
import { timezoneLabel } from '@/lib/constants';
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

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Connecting…' : 'Connect this shop'}
    </Button>
  );
}

export function ConnectIntegrationForm() {
  const [state, action] = useFormState(connectIntegrationAction, initial);
  const [provider, setProvider] = useState<Provider>('woocommerce');

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {/* The description below the picker was a second child, so `FormField`
            skipped the clone that gives the control its `id` — the label above
            this select pointed at nothing. As `hint` it is both wired up and
            read out on focus. */}
        <FormField label="Provider" htmlFor="provider" hint={PROVIDER_HELP[provider]}>
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
        </FormField>
        <FormField
          label="Connection name"
          htmlFor="name"
          required
          hint="Only you see this. It is how this connection is named in the list below."
        >
          <Input name="name" required placeholder="My store" />
        </FormField>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/*
          The server only validates `provider` and `name`; every credential
          below is stored as-is. A shop that left them blank was told
          "Integration connected" and then quietly failed on every refresh with
          "Missing WooCommerce credentials" (src/lib/integrations/sync.ts:122).
          The three fields each `sync.ts` refuses to run without are now
          `required` in the browser, so the failure happens at the field that
          caused it instead of hours later in a log.
        */}
        {provider === 'woocommerce' ? (
          <>
            <FormField
              label="WordPress store URL"
              htmlFor="base_url"
              required
              hint="The address customers visit, including https:// and no trailing path."
            >
              <Input
                name="base_url"
                type="url"
                required
                placeholder="https://yourwordpressstore.com"
              />
            </FormField>
            <FormField
              label="Consumer key"
              htmlFor="consumer_key"
              required
              hint="In WordPress: WooCommerce → Settings → Advanced → REST API → Add key, with Read permission. It starts ck_."
            >
              <Input name="consumer_key" autoComplete="off" required placeholder="ck_..." />
            </FormField>
            <FormField
              label="Consumer secret"
              htmlFor="consumer_secret"
              required
              hint="Shown once, next to the consumer key, when you create it. It starts cs_."
            >
              <Input name="consumer_secret" type="password" autoComplete="new-password" required placeholder="cs_..." />
            </FormField>
            <FormField
              label="Default currency"
              htmlFor="currency"
              hint="The three-letter code your shop prices in — USD, GBP, EUR, AED. Prices we read from your shop are shown in this currency."
            >
              <Input
                name="currency"
                maxLength={3}
                pattern="[A-Za-z]{3}"
                placeholder="USD"
              />
            </FormField>
          </>
        ) : null}
        {provider === 'shopify' ? (
          <>
            <FormField
              label="Shop domain"
              htmlFor="shop"
              required
              hint="Your permanent myshopify.com address, not a custom domain and not a full link — your-store.myshopify.com."
            >
              <Input
                name="shop"
                required
                pattern="[A-Za-z0-9-]+\.myshopify\.com"
                placeholder="your-store.myshopify.com"
              />
            </FormField>
            <FormField
              label="Admin API access token"
              htmlFor="access_token"
              required
              hint="Shopify admin → Settings → Apps and sales channels → Develop apps → your app → API credentials. It starts shpat_ and is shown only once."
            >
              <Input name="access_token" type="password" autoComplete="new-password" required placeholder="shpat_..." />
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
              <Input
                name="currency"
                maxLength={3}
                pattern="[A-Za-z]{3}"
                placeholder="USD"
              />
            </FormField>
          </>
        ) : null}
        {provider === 'google_calendar' ? (
          <>
            <FormField
              label="Calendar"
              htmlFor="calendar_id"
              hint="Leave it as primary to use the main calendar of the account below. For any other calendar, use the Calendar ID from its settings page — usually an email-shaped address."
            >
              <Input name="calendar_id" placeholder="primary" defaultValue="primary" />
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
            <FormField
              label="Access token"
              htmlFor="access_token"
              required
              hint="A Google OAuth access token for the account that owns the calendar. Without one, no times are ever offered (src/lib/integrations/google-calendar.ts:25)."
            >
              <Input name="access_token" type="password" autoComplete="new-password" required />
            </FormField>
          </>
        ) : null}
        {provider === 'custom_api' ? (
          <>
            <FormField
              label="API base URL"
              htmlFor="base_url"
              required
              hint="Everything below is added to the end of this address. No trailing slash."
            >
              <Input name="base_url" type="url" required placeholder="https://api.example.com" />
            </FormField>
            <FormField
              label="API token"
              htmlFor="token"
              hint="Sent as a bearer token on every request. Leave empty if your API needs no authentication."
            >
              <Input name="token" type="password" autoComplete="new-password" />
            </FormField>
            {/* The four paths default server-side to /products, /inventory,
                /orders and /customers, so the placeholder was showing a value
                that would be used anyway and reading as an example to replace.
                The hint says what empty means. */}
            <FormField
              label="Products path"
              htmlFor="products_path"
              hint="Starts with a slash. Leave empty for /products."
            >
              <Input name="products_path" pattern="/.*" placeholder="/products" />
            </FormField>
            <FormField
              label="Inventory path"
              htmlFor="inventory_path"
              hint="Starts with a slash. Leave empty for /inventory."
            >
              <Input name="inventory_path" pattern="/.*" placeholder="/inventory" />
            </FormField>
            <FormField
              label="Orders path"
              htmlFor="orders_path"
              hint="Starts with a slash. Leave empty for /orders."
            >
              <Input name="orders_path" pattern="/.*" placeholder="/orders" />
            </FormField>
            <FormField
              label="Customers path"
              htmlFor="customers_path"
              hint="Starts with a slash. Leave empty for /customers."
            >
              <Input name="customers_path" pattern="/.*" placeholder="/customers" />
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
            <Input name="extra_secret" type="password" autoComplete="new-password" />
          </FormField>
        </div>
      </details>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-emerald-600">Integration connected.</p> : null}
      <Submit />
    </form>
  );
}
