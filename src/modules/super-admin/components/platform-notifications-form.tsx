'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  updatePlatformNotificationsAction,
  type PlatformNotificationsActionState,
} from '../notifications-actions';
import type { PlatformNotificationSettingsView } from '../notifications-data';

const initial: PlatformNotificationsActionState = {};
const selectCls =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function SubmitButton() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? 'Saving...' : 'Save platform notifications'}</Button>;
}

export function PlatformNotificationsForm({ settings }: { settings: PlatformNotificationSettingsView }) {
  const [state, formAction] = useFormState(updatePlatformNotificationsAction, initial);

  return (
    <form action={formAction} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="defaultEmailMode">Default company email option</Label>
          <select id="defaultEmailMode" name="defaultEmailMode" className={selectCls} defaultValue={settings.defaultEmailMode}>
            <option value="platform">Use platform sender by default</option>
            <option value="company_smtp">Let company configure SMTP by default</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="whatsappProvider">Platform-managed WhatsApp provider</Label>
          <select id="whatsappProvider" name="whatsappProvider" className={selectCls} defaultValue={settings.whatsappProvider}>
            <option value="disabled">Disabled</option>
            <option value="meta_cloud">Meta Cloud API</option>
            <option value="twilio">Twilio WhatsApp</option>
          </select>
          <p className="text-xs text-muted-foreground">
            Used only when a company is explicitly set to platform-managed WhatsApp.
          </p>
        </div>
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">Meta Cloud API managed sender</h2>
          <p className="text-sm text-muted-foreground">
            Company-owned WhatsApp credentials are configured inside the company account. These
            platform credentials are only for a paid/support managed sender.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="metaPhoneNumberId">Phone number ID</Label>
            <Input id="metaPhoneNumberId" name="metaPhoneNumberId" defaultValue={settings.metaPhoneNumberId} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="metaAccessToken">Access token</Label>
            <Input
              id="metaAccessToken"
              name="metaAccessToken"
              type="password"
              placeholder={settings.hasMetaAccessToken ? 'Saved. Leave blank to keep.' : ''}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="metaTemplateName">Template name</Label>
            <Input id="metaTemplateName" name="metaTemplateName" defaultValue={settings.metaTemplateName} placeholder="lead_alert" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="metaTemplateLanguage">Template language</Label>
            <Input id="metaTemplateLanguage" name="metaTemplateLanguage" defaultValue={settings.metaTemplateLanguage} placeholder="en_GB" />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">Twilio WhatsApp managed sender</h2>
          <p className="text-sm text-muted-foreground">
            Do not use this for normal company accounts unless you intend the platform to own and
            bill the WhatsApp sender.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="twilioAccountSid">Account SID</Label>
            <Input id="twilioAccountSid" name="twilioAccountSid" defaultValue={settings.twilioAccountSid} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="twilioAuthToken">Auth token</Label>
            <Input
              id="twilioAuthToken"
              name="twilioAuthToken"
              type="password"
              placeholder={settings.hasTwilioAuthToken ? 'Saved. Leave blank to keep.' : ''}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="twilioWhatsappFrom">WhatsApp from number</Label>
            <Input id="twilioWhatsappFrom" name="twilioWhatsappFrom" defaultValue={settings.twilioWhatsappFrom} placeholder="+14155238886" />
          </div>
        </div>
      </section>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-emerald-600">Platform notification settings saved.</p> : null}
      <SubmitButton />
    </form>
  );
}
