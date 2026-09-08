'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { Alert } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { connectIntegrationAction } from '../integrations-actions';
import type { ActionState } from '../actions';
import { TIMEZONE_OPTIONS } from '../form-options';
import { timezoneLabel } from '@/lib/constants';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { Select } from '@/components/ui/select';
import { SubmitButton } from '@/components/ui/submit-button';
import {
  FIELD_GRID,
  FIELD_GRID_WIDE,
  FORM_SECTION,
  FORM_SECTION_TITLE,
} from './form-layout';

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
 * The heading over the credentials section, per provider.
 *
 * "Sign-in details" on its own left the owner reading a wall of eight boxes with
 * no idea which product they were supposed to be looking in. Naming the product
 * in the heading is what turns the section into an instruction.
 */
const CREDENTIAL_HEADINGS: Record<Provider, string> = {
  woocommerce: 'Your WooCommerce sign-in details',
  shopify: 'Your Shopify sign-in details',
  custom_api: 'Where your API is, and how to reach it',
  google_calendar: 'Which calendar, and the account that owns it',
};

export function ConnectIntegrationForm() {
  const [state, action] = useFormState(connectIntegrationAction, initial);
  const [provider, setProvider] = useState<Provider>('woocommerce');

  return (
    <form action={action} className="space-y-6">
      {/*
        SECTIONS, NOT ONE WALL
        ----------------------
        This form asks for up to ten things and the answers come from two
        different places: the first two the owner invents, the rest they have to
        go and find inside another product's admin. Splitting those into two
        titled sections is the difference between "fill this in" and "go and
        fetch eight values from somewhere else, in an order nobody stated".

        Every grid here is `FIELD_GRID` rather than `sm:grid-cols-2`. This form
        renders in the 1fr side of the split on `/company/integrations`, which is
        about 400px wide on a 1280px screen — and `sm:` is fully switched on at
        that point, so `sm:grid-cols-2` meant two 185px columns holding hints
        like "Shopify admin → Settings → Apps and sales channels → Develop apps
        → your app → API credentials". See `form-layout.ts`.
      */}
      <section className={FORM_SECTION}>
        <h3 className={FORM_SECTION_TITLE}>What are you connecting?</h3>
        <div className={FIELD_GRID}>
          {/* The description below the picker was a second child, so `FormField`
              skipped the clone that gives the control its `id` — the label above
              this select pointed at nothing. As `hint` it is both wired up and
              read out on focus. */}
          <FormField label="Provider" htmlFor="provider" required hint={PROVIDER_HELP[provider]}>
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
      </section>

      <section className={FORM_SECTION}>
        <h3 className={FORM_SECTION_TITLE}>{CREDENTIAL_HEADINGS[provider]}</h3>

        {/*
          The server only validates `provider` and `name`; every credential
          below is stored as-is. A shop that left them blank was told
          "Integration connected" and then quietly failed on every refresh with
          "Missing WooCommerce credentials" (src/lib/integrations/sync.ts:122).
          The three fields each `sync.ts` refuses to run without are `required`
          in the browser, so the failure happens at the field that caused it
          instead of hours later in a log.

          Every secret is a `PasswordInput`, not a bare `type="password"`. These
          are values the owner has pasted out of another product's admin screen,
          usually on a phone, and they are shown exactly once at the source — a
          field that will not let them check what they pasted is a field that
          sends them back to Shopify to generate a second token.
        */}
        {provider === 'woocommerce' ? (
          <div className={FIELD_GRID}>
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
              <PasswordInput
                name="consumer_secret"
                autoComplete="new-password"
                required
                placeholder="cs_..."
              />
            </FormField>
            <FormField
              label="Default currency"
              htmlFor="currency"
              hint="The three-letter code your shop prices in — USD, GBP, EUR, AED. Prices we read from your shop are shown in this currency."
            >
              <Input name="currency" maxLength={3} pattern="[A-Za-z]{3}" placeholder="USD" />
            </FormField>
          </div>
        ) : null}

        {provider === 'shopify' ? (
          <div className={FIELD_GRID}>
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
              <PasswordInput
                name="access_token"
                autoComplete="new-password"
                required
                placeholder="shpat_..."
              />
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
              <Input name="currency" maxLength={3} pattern="[A-Za-z]{3}" placeholder="USD" />
            </FormField>
          </div>
        ) : null}

        {provider === 'google_calendar' ? (
          <div className={FIELD_GRID}>
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
              hint="A Google OAuth access token for the account that owns the calendar. Without one, no times are ever offered."
            >
              <PasswordInput name="access_token" autoComplete="new-password" required />
            </FormField>
          </div>
        ) : null}

        {provider === 'custom_api' ? (
          <div className="space-y-4">
            {/* `FIELD_GRID_WIDE` for the two that hold a URL and a bearer token:
                both are long and unbreakable, and a 16rem box shows the middle
                of a token rather than either end of it. */}
            <div className={FIELD_GRID_WIDE}>
              <FormField
                label="API base URL"
                htmlFor="base_url"
                required
                hint="Every path below is added to the end of this address. No trailing slash."
              >
                <Input name="base_url" type="url" required placeholder="https://api.example.com" />
              </FormField>
              <FormField
                label="API token"
                htmlFor="token"
                hint="Sent as a bearer token on every request. Leave empty if your API needs no authentication."
              >
                <PasswordInput name="token" autoComplete="new-password" />
              </FormField>
            </div>

            {/* The four paths are one decision repeated, not four decisions, so
                they are their own group under their own label. Each defaults
                server-side, so the hint says what empty means rather than
                showing a value that would be used anyway. */}
            <fieldset className="space-y-3 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">Where each list lives</legend>
              <p className="text-xs text-muted-foreground">
                Leave all four empty unless your API puts them somewhere other than the usual
                place.
              </p>
              <div className={FIELD_GRID}>
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
              </div>
            </fieldset>

            {/* Was a hand-rolled `bg-muted/30` note. `Alert tone="info"` is the
                primitive for a standing notice, and it is defined in dark mode. */}
            <Alert tone="info">
              Your API should return JSON arrays, or objects with{' '}
              <code className="rounded bg-background/60 px-1">products</code>,{' '}
              <code className="rounded bg-background/60 px-1">inventory</code>,{' '}
              <code className="rounded bg-background/60 px-1">orders</code> and{' '}
              <code className="rounded bg-background/60 px-1">customers</code> keys.{' '}
              <a
                className="font-medium underline underline-offset-4"
                href="/api/integrations/custom/schema"
                target="_blank"
                rel="noopener noreferrer"
              >
                Read the schema
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </Alert>
          </div>
        ) : null}
      </section>

      <details className="rounded-md border p-3">
        <summary className="cursor-pointer list-none text-sm font-medium">
          Advanced credentials
          <span className="ms-2 font-normal text-muted-foreground">
            — most shops never open this
          </span>
        </summary>
        {/* These two are a passthrough: whatever is typed is stored in the
            encrypted credentials blob under the same names, and nothing reads
            them unless a specific setup asks for them. Saying "most shops leave
            these empty" is the honest instruction — an owner filling in every
            box they can see is the failure this panel invited. */}
        <div className={`mt-4 ${FIELD_GRID}`}>
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
            <PasswordInput name="extra_secret" autoComplete="new-password" />
          </FormField>
        </div>
      </details>

      {/* Was two hand-rolled paragraphs, one of them `text-emerald-600` — a
          colour that fails AA on white and is undefined in dark mode, and
          neither of them a live region, so a screen-reader user pressed
          "Connect" and was told nothing at all. */}
      <FormMessage
        state={state}
        okText="Connected. It appears in the list beside this and refreshes within the hour."
      />
      <SubmitButton pendingLabel="Connecting…">Connect this shop</SubmitButton>
    </form>
  );
}
