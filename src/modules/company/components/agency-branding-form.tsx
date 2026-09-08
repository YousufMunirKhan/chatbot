'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import type { AgencyBranding } from '@/lib/agency';
import { updateAgencyBrandingAction, type ActionState } from '../agency-actions';

const initial: ActionState = {};
const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Branding editor with a live preview.
 *
 * The preview is the reason this is a client component: an agency owner is
 * choosing a colour and a logo, and "save, reload, look" is three steps too
 * many to iterate on a shade of blue. State lives here and the same values feed
 * both the inputs and the swatch, so what they see is exactly what the shell
 * will render.
 */
export function AgencyBrandingForm({ branding }: { branding: AgencyBranding }) {
  const [state, action] = useFormState(updateAgencyBrandingAction, initial);
  const [productName, setProductName] = useState(branding.productName);
  const [primaryColor, setPrimaryColor] = useState(branding.primaryColor);
  const [logoUrl, setLogoUrl] = useState(branding.logoUrl ?? '');
  const [hidePoweredBy, setHidePoweredBy] = useState(branding.hidePoweredBy);

  const colorValid = HEX.test(primaryColor);
  const previewColor = colorValid ? primaryColor : '#2563eb';

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <form action={action} className="space-y-4">
        <FormField
          label="Product name"
          htmlFor="productName"
          hint="Shown in the sidebar and on the login page."
        >
          <Input
            id="productName"
            name="productName"
            maxLength={80}
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
          />
        </FormField>

        <FormField
          label="Primary colour"
          htmlFor="primaryColor"
          hint="Hex, e.g. #2563eb."
          error={primaryColor && !colorValid ? 'Enter six hex digits after the #.' : undefined}
        >
          <Input
            id="primaryColor"
            name="primaryColor"
            maxLength={7}
            value={primaryColor}
            onChange={(e) => setPrimaryColor(e.target.value)}
          />
        </FormField>

        <FormField
          label="Logo URL"
          htmlFor="logoUrl"
          hint="An https:// image, or a path on this app."
        >
          <Input
            id="logoUrl"
            name="logoUrl"
            type="url"
            inputMode="url"
            placeholder="https://example.com/logo.svg"
            maxLength={500}
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
          />
        </FormField>

        <FormField
          label="Login page background"
          htmlFor="loginBackground"
          hint="A wide image shown behind the sign-in box. Leave it empty for the plain background."
        >
          <Input
            id="loginBackground"
            name="loginBackground"
            type="url"
            inputMode="url"
            placeholder="https://example.com/background.jpg"
            maxLength={500}
            defaultValue={branding.loginBackground ?? ''}
          />
        </FormField>

        <FormField label="Support email" htmlFor="supportEmail">
          <Input
            id="supportEmail"
            name="supportEmail"
            type="email"
            maxLength={200}
            defaultValue={branding.supportEmail ?? ''}
          />
        </FormField>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="hidePoweredBy"
            checked={hidePoweredBy}
            onChange={(e) => setHidePoweredBy(e.target.checked)}
            className="h-4 w-4 rounded border-input"
          />
          Hide &ldquo;Powered by&rdquo; in the widget
        </label>

        <FormMessage state={state} okText="Branding saved." />
        <SubmitButton pendingLabel="Saving…">Save branding</SubmitButton>
      </form>

      {/* --- live preview ---------------------------------------------------- */}
      <div className="space-y-3">
        <p className="text-sm font-medium">Preview</p>
        <div className="overflow-hidden rounded-lg border">
          <div
            className="flex items-center gap-3 p-4 text-white"
            style={{ backgroundColor: previewColor }}
          >
            {logoUrl ? (
              // A plain <img>: the logo is an arbitrary customer-supplied host,
              // and next/image would need every one of them in remotePatterns.
              //
              // `bg-brand-plate`, not `bg-white/90`. The product already has a
              // token for exactly this — the white plate that sits under a
              // customer-supplied logo PNG, white in both themes on purpose,
              // used by the sidebar, the auth shell and the marketing header.
              // This was the fourth place inventing its own version of it.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt=""
                className="h-8 w-auto max-w-[10rem] rounded bg-brand-plate object-contain p-1"
              />
            ) : (
              // Left as translucent white on purpose, and NOT switched to a
              // token: this chip sits on `previewColor`, an arbitrary colour the
              // agency picked, not on any theme surface. `--brand-plate` takes
              // no opacity modifier (it is a bare `hsl(var(…))` in the Tailwind
              // config, with no `<alpha-value>` slot), so asking for 20% of it
              // would silently emit nothing.
              <span className="rounded bg-white/20 px-2 py-1 text-xs uppercase tracking-wider">
                No logo
              </span>
            )}
            <span className="truncate font-semibold">{productName || 'Product name'}</span>
          </div>
          <div className="space-y-2 p-4 text-sm">
            <p className="font-medium">Sidebar and login page</p>
            <p className="text-muted-foreground">
              Every company attached to your agency sees this name and logo instead of the
              platform&apos;s.
            </p>
            <p className="text-xs text-muted-foreground">
              {hidePoweredBy
                ? 'The widget shows no “Powered by” line.'
                : 'The widget keeps its “Powered by” line.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
