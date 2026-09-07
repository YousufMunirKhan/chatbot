'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  saveNotificationSettingsAction,
  type NotificationSettingsActionState,
} from '../notifications-actions';
import { type CompanyNotificationSettingsView } from '../notification-settings';
import { DELIVERY_CHANNELS, NOTIFICATION_EVENTS } from '../notification-options';
import { FormField } from '@/components/ui/form-field';
import { Select } from '@/components/ui/select';

const initial: NotificationSettingsActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving...' : 'Save notification settings'}
    </Button>
  );
}

export function NotificationSettingsForm({
  settings,
}: {
  settings: CompanyNotificationSettingsView;
}) {
  const [state, formAction] = useFormState(saveNotificationSettingsAction, initial);
  // Which WhatsApp provider's credentials to ask for. Both sets used to render
  // at once, so a company on Twilio was still shown Meta's fields and had no
  // way to tell which ones the product would actually use.
  const [provider, setProvider] = useState(settings.whatsappProvider);

  return (
    <form action={formAction} className="space-y-8">
      <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
        <input
          type="checkbox"
          name="notificationsEnabled"
          defaultChecked={settings.notificationsEnabled}
          className="h-4 w-4"
        />
        Enable outbound notifications for new leads, bookings, orders, and handoff requests
      </label>

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold">Email</h2>
          <p className="text-sm text-muted-foreground">
            Use the platform sender, or let this company send from its own SMTP account.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
            <input
              type="checkbox"
              name="emailEnabled"
              defaultChecked={settings.emailEnabled}
              className="h-4 w-4"
            />
            Send email notifications
          </label>
          <FormField label="Sender mode" htmlFor="emailSenderMode">
            <Select name="emailSenderMode" defaultValue={settings.emailSenderMode}>
              <option value="platform">Use platform sender</option>
              <option value="company_smtp">Use company SMTP</option>
            </Select>
          </FormField>
          <FormField label="To recipients" htmlFor="emailTo">
            <Textarea
              name="emailTo"
              rows={3}
              defaultValue={settings.emailTo.join('\n')}
              placeholder="owner@example.com"
            />
          </FormField>
          <FormField label="CC recipients" htmlFor="emailCc">
            <Textarea
              name="emailCc"
              rows={3}
              defaultValue={settings.emailCc.join('\n')}
              placeholder="manager@example.com"
            />
          </FormField>
          <FormField label="BCC recipients" htmlFor="emailBcc">
            <Textarea name="emailBcc" rows={3} defaultValue={settings.emailBcc.join('\n')} />
          </FormField>
          <FormField label="Reply-to email" htmlFor="emailReplyTo">
            <Input name="emailReplyTo" type="email" defaultValue={settings.emailReplyTo} />
          </FormField>
        </div>
        <details className="rounded-md border p-4">
          <summary className="cursor-pointer text-sm font-medium">Company SMTP details</summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <FormField label="From email" htmlFor="smtpFromEmail">
              <Input name="smtpFromEmail" type="email" defaultValue={settings.smtpFromEmail} />
            </FormField>
            <FormField label="From name" htmlFor="smtpFromName">
              <Input name="smtpFromName" defaultValue={settings.smtpFromName} />
            </FormField>
            <FormField label="SMTP host" htmlFor="smtpHost">
              <Input name="smtpHost" defaultValue={settings.smtpHost} />
            </FormField>
            <FormField label="SMTP port" htmlFor="smtpPort">
              <Input name="smtpPort" inputMode="numeric" defaultValue={settings.smtpPort} />
            </FormField>
            <FormField label="SMTP username" htmlFor="smtpUsername">
              <Input name="smtpUsername" defaultValue={settings.smtpUsername} />
            </FormField>
            <FormField label="SMTP password" htmlFor="smtpPassword">
              <Input
                name="smtpPassword"
                type="password"
                placeholder={settings.hasSmtpPassword ? 'Saved. Leave blank to keep.' : ''}
              />
            </FormField>
            <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
              <input
                type="checkbox"
                name="smtpSecure"
                defaultChecked={settings.smtpSecure}
                className="h-4 w-4"
              />
              Use secure SMTP connection
            </label>
          </div>
        </details>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold">WhatsApp</h2>
          <p className="text-sm text-muted-foreground">
            Connect your company Meta or Twilio WhatsApp account. Your company owns the sender
            account and provider charges unless support has explicitly enabled a managed sender.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
            <input
              type="checkbox"
              name="whatsappEnabled"
              defaultChecked={settings.whatsappEnabled}
              className="h-4 w-4"
            />
            Send WhatsApp notifications
          </label>
          <FormField label="Sender owner" htmlFor="whatsappSenderMode">
            <Select name="whatsappSenderMode" defaultValue={settings.whatsappSenderMode}>
              <option value="company">Company-managed sender</option>
              <option value="platform_managed">Platform-managed sender (support add-on)</option>
            </Select>
          </FormField>
          <FormField
            label="WhatsApp provider"
            htmlFor="whatsappProvider"
            hint="Only the credentials for the provider you pick are asked for below."
          >
            <Select
              id="whatsappProvider"
              name="whatsappProvider"
              defaultValue={settings.whatsappProvider}
              onChange={(e) =>
                setProvider(e.currentTarget.value as typeof settings.whatsappProvider)
              }
            >
              <option value="disabled">Not sending WhatsApp alerts</option>
              <option value="meta_cloud">Meta Cloud API (direct from WhatsApp)</option>
              <option value="twilio">Twilio</option>
            </Select>
          </FormField>
          <FormField
            label="WhatsApp recipient numbers"
            htmlFor="whatsappRecipients"
            className="sm:col-span-2"
            hint="One number per line, with the country code."
          >
            <Textarea
              id="whatsappRecipients"
              name="whatsappRecipients"
              rows={3}
              defaultValue={settings.whatsappRecipients.join('\n')}
              placeholder="+447700900123"
            />
          </FormField>

          {/* Only the chosen provider's credentials are shown. Both blocks used
              to render at once, so a company on Twilio was still asked for Meta
              details and could not tell which set actually mattered. */}
          {provider === 'meta_cloud' ? (
            <div className="rounded-md border p-4 sm:col-span-2">
              <h3 className="text-sm font-semibold">Meta Cloud API details</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                From Meta Business → WhatsApp → API Setup.
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <FormField
                  label="Phone number ID"
                  htmlFor="metaPhoneNumberId"
                  hint="A long number from Meta, not your phone number and not an email address."
                >
                  <Input
                    id="metaPhoneNumberId"
                    name="metaPhoneNumberId"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    defaultValue={settings.metaPhoneNumberId}
                    placeholder="109876543210987"
                  />
                </FormField>
                <FormField
                  label="Access token"
                  htmlFor="metaAccessToken"
                  hint="Use a permanent token — a temporary one stops working in 24 hours."
                >
                  <Input
                    id="metaAccessToken"
                    name="metaAccessToken"
                    type="password"
                    placeholder={settings.hasMetaAccessToken ? 'Saved. Leave blank to keep.' : ''}
                  />
                </FormField>
                <FormField
                  label="Template name"
                  htmlFor="metaTemplateName"
                  hint="An approved template. Alerts sent outside the 24-hour window need one."
                >
                  <Input
                    id="metaTemplateName"
                    name="metaTemplateName"
                    defaultValue={settings.metaTemplateName}
                    placeholder="lead_alert"
                  />
                </FormField>
                <FormField
                  label="Template language"
                  htmlFor="metaTemplateLanguage"
                  hint="The language code the template was approved in, e.g. en_GB."
                >
                  <Input
                    id="metaTemplateLanguage"
                    name="metaTemplateLanguage"
                    defaultValue={settings.metaTemplateLanguage}
                    placeholder="en_GB"
                  />
                </FormField>
              </div>
            </div>
          ) : null}

          {provider === 'twilio' ? (
            <div className="rounded-md border p-4 sm:col-span-2">
              <h3 className="text-sm font-semibold">Twilio details</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                From your Twilio console dashboard.
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <FormField label="Account SID" htmlFor="twilioAccountSid" hint="Starts with AC.">
                  <Input
                    id="twilioAccountSid"
                    name="twilioAccountSid"
                    defaultValue={settings.twilioAccountSid}
                    placeholder="AC00000000000000000000000000000000"
                  />
                </FormField>
                <FormField label="Auth token" htmlFor="twilioAuthToken">
                  <Input
                    id="twilioAuthToken"
                    name="twilioAuthToken"
                    type="password"
                    placeholder={settings.hasTwilioAuthToken ? 'Saved. Leave blank to keep.' : ''}
                  />
                </FormField>
                <FormField
                  label="WhatsApp from number"
                  htmlFor="twilioWhatsappFrom"
                  hint="The WhatsApp-enabled number Twilio gave you."
                >
                  <Input
                    id="twilioWhatsappFrom"
                    name="twilioWhatsappFrom"
                    defaultValue={settings.twilioWhatsappFrom}
                    placeholder="+14155238886"
                  />
                </FormField>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold">Slack and Webhook (moving to Webhooks)</h2>
          <p className="text-sm text-muted-foreground">
            Optional team alerts and system-to-system delivery for automation tools.
          </p>
        </div>
        {/*
          Module 26 owns Slack and webhook delivery now. These fields still work
          for anyone who configured them here, but they are being retired: if the
          same event is covered by an endpoint on /company/webhooks, that endpoint
          delivers it and the channels below stay quiet, so nothing is ever sent
          twice. Email and WhatsApp above are unaffected.
        */}
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">Set these up on the Webhooks page instead.</p>
          <p className="mt-1 text-muted-foreground">
            <Link href="/company/webhooks" className="font-medium underline underline-offset-4">
              Webhooks
            </Link>{' '}
            is where Slack and outgoing webhooks live now — it adds per-endpoint event selection,
            signing secrets, delivery logs and a test button. Anything you set up there takes over
            from the fields below, so you will not get duplicate alerts. These fields will be
            removed in a future release.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
            <input
              type="checkbox"
              name="slackEnabled"
              defaultChecked={settings.slackEnabled}
              className="h-4 w-4"
            />
            Send Slack notifications (legacy)
          </label>
          <FormField label="Slack incoming webhook" htmlFor="slackWebhookUrl">
            <Input
              name="slackWebhookUrl"
              type="url"
              placeholder={
                settings.hasSlackWebhook
                  ? 'Saved. Leave blank to keep.'
                  : 'https://hooks.slack.com/...'
              }
            />
          </FormField>
          <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
            <input
              type="checkbox"
              name="webhookEnabled"
              defaultChecked={settings.webhookEnabled}
              className="h-4 w-4"
            />
            Send generic webhook (legacy)
          </label>
          <FormField label="Webhook URL" htmlFor="genericWebhookUrl">
            <Input
              name="genericWebhookUrl"
              type="url"
              placeholder={
                settings.hasGenericWebhookUrl
                  ? 'Saved. Leave blank to keep.'
                  : 'https://example.com/webhook'
              }
            />
          </FormField>
          <FormField
            label="Webhook signing secret"
            htmlFor="genericWebhookSecret"
            className="sm:col-span-2"
          >
            <Input
              name="genericWebhookSecret"
              type="password"
              placeholder={
                settings.hasGenericWebhookSecret ? 'Saved. Leave blank to keep.' : 'Optional'
              }
            />
          </FormField>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold">Event rules</h2>
          <p className="text-sm text-muted-foreground">Choose which events go to each channel.</p>
        </div>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-3 py-2 text-start font-medium">Event</th>
                {DELIVERY_CHANNELS.map((channel) => (
                  <th key={channel.key} className="px-3 py-2 text-start font-medium">
                    {channel.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {NOTIFICATION_EVENTS.map((event) => (
                <tr key={event.key} className="border-t">
                  <td className="px-3 py-2 font-medium">{event.label}</td>
                  {DELIVERY_CHANNELS.map((channel) => (
                    <td key={channel.key} className="px-3 py-2">
                      <input
                        type="checkbox"
                        name={`${event.key}.${channel.key}`}
                        defaultChecked={settings.eventRules[event.key]?.[channel.key] !== false}
                        className="h-4 w-4"
                        aria-label={`${event.label} ${channel.label}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-emerald-600">Notification settings saved.</p> : null}
      <SubmitButton />
    </form>
  );
}
