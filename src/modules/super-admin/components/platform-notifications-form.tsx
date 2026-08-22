'use client';

import { useFormState } from 'react-dom';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { SubmitButton } from '@/components/ui/submit-button';
import {
  updatePlatformNotificationsAction,
  type PlatformNotificationsActionState,
} from '../notifications-actions';
import type { PlatformNotificationSettingsView } from '../notifications-data';

const initial: PlatformNotificationsActionState = {};

export function PlatformNotificationsForm({ settings }: { settings: PlatformNotificationSettingsView }) {
  const [state, formAction] = useFormState(updatePlatformNotificationsAction, initial);

  return (
    <form action={formAction} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Default company email option" htmlFor="defaultEmailMode">
          <Select id="defaultEmailMode" name="defaultEmailMode" defaultValue={settings.defaultEmailMode}>
            <option value="platform">Use platform sender by default</option>
            <option value="company_smtp">Let company configure SMTP by default</option>
          </Select>
        </FormField>
        <FormField
          label="Platform-managed WhatsApp provider"
          htmlFor="whatsappProvider"
          hint="Used only when a company is explicitly set to platform-managed WhatsApp."
        >
          <Select id="whatsappProvider" name="whatsappProvider" defaultValue={settings.whatsappProvider}>
            <option value="disabled">Disabled</option>
            <option value="meta_cloud">Meta Cloud API</option>
            <option value="twilio">Twilio WhatsApp</option>
          </Select>
        </FormField>
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
          <FormField label="Phone number ID" htmlFor="metaPhoneNumberId">
            <Input id="metaPhoneNumberId" name="metaPhoneNumberId" defaultValue={settings.metaPhoneNumberId} />
          </FormField>
          <FormField label="Access token" htmlFor="metaAccessToken">
            <Input
              id="metaAccessToken"
              name="metaAccessToken"
              type="password"
              placeholder={settings.hasMetaAccessToken ? 'Saved. Leave blank to keep.' : ''}
            />
          </FormField>
          <FormField label="Template name" htmlFor="metaTemplateName">
            <Input id="metaTemplateName" name="metaTemplateName" defaultValue={settings.metaTemplateName} placeholder="lead_alert" />
          </FormField>
          <FormField label="Template language" htmlFor="metaTemplateLanguage">
            <Input id="metaTemplateLanguage" name="metaTemplateLanguage" defaultValue={settings.metaTemplateLanguage} placeholder="en_GB" />
          </FormField>
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
          <FormField label="Account SID" htmlFor="twilioAccountSid">
            <Input id="twilioAccountSid" name="twilioAccountSid" defaultValue={settings.twilioAccountSid} />
          </FormField>
          <FormField label="Auth token" htmlFor="twilioAuthToken">
            <Input
              id="twilioAuthToken"
              name="twilioAuthToken"
              type="password"
              placeholder={settings.hasTwilioAuthToken ? 'Saved. Leave blank to keep.' : ''}
            />
          </FormField>
          <FormField label="WhatsApp from number" htmlFor="twilioWhatsappFrom">
            <Input id="twilioWhatsappFrom" name="twilioWhatsappFrom" defaultValue={settings.twilioWhatsappFrom} placeholder="+14155238886" />
          </FormField>
        </div>
      </section>

      <FormMessage state={state} okText="Platform notification settings saved." />
      <SubmitButton pendingLabel="Saving...">Save platform notifications</SubmitButton>
    </form>
  );
}
