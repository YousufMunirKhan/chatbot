'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { saveNotificationSettingsAction, type NotificationSettingsActionState } from '../notifications-actions';
import {
  type CompanyNotificationSettingsView,
} from '../notification-settings';
import { DELIVERY_CHANNELS, NOTIFICATION_EVENTS } from '../notification-options';

const initial: NotificationSettingsActionState = {};
const selectCls =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function SubmitButton() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? 'Saving...' : 'Save notification settings'}</Button>;
}

export function NotificationSettingsForm({ settings }: { settings: CompanyNotificationSettingsView }) {
  const [state, formAction] = useFormState(saveNotificationSettingsAction, initial);

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
            <input type="checkbox" name="emailEnabled" defaultChecked={settings.emailEnabled} className="h-4 w-4" />
            Send email notifications
          </label>
          <div className="space-y-1.5">
            <Label htmlFor="emailSenderMode">Sender mode</Label>
            <select id="emailSenderMode" name="emailSenderMode" className={selectCls} defaultValue={settings.emailSenderMode}>
              <option value="platform">Use platform sender</option>
              <option value="company_smtp">Use company SMTP</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="emailTo">To recipients</Label>
            <Textarea id="emailTo" name="emailTo" rows={3} defaultValue={settings.emailTo.join('\n')} placeholder="owner@example.com" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="emailCc">CC recipients</Label>
            <Textarea id="emailCc" name="emailCc" rows={3} defaultValue={settings.emailCc.join('\n')} placeholder="manager@example.com" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="emailBcc">BCC recipients</Label>
            <Textarea id="emailBcc" name="emailBcc" rows={3} defaultValue={settings.emailBcc.join('\n')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="emailReplyTo">Reply-to email</Label>
            <Input id="emailReplyTo" name="emailReplyTo" type="email" defaultValue={settings.emailReplyTo} />
          </div>
        </div>
        <details className="rounded-md border p-4">
          <summary className="cursor-pointer text-sm font-medium">Company SMTP details</summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="smtpFromEmail">From email</Label>
              <Input id="smtpFromEmail" name="smtpFromEmail" type="email" defaultValue={settings.smtpFromEmail} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtpFromName">From name</Label>
              <Input id="smtpFromName" name="smtpFromName" defaultValue={settings.smtpFromName} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtpHost">SMTP host</Label>
              <Input id="smtpHost" name="smtpHost" defaultValue={settings.smtpHost} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtpPort">SMTP port</Label>
              <Input id="smtpPort" name="smtpPort" inputMode="numeric" defaultValue={settings.smtpPort} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtpUsername">SMTP username</Label>
              <Input id="smtpUsername" name="smtpUsername" defaultValue={settings.smtpUsername} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtpPassword">SMTP password</Label>
              <Input
                id="smtpPassword"
                name="smtpPassword"
                type="password"
                placeholder={settings.hasSmtpPassword ? 'Saved. Leave blank to keep.' : ''}
              />
            </div>
            <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
              <input type="checkbox" name="smtpSecure" defaultChecked={settings.smtpSecure} className="h-4 w-4" />
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
            <input type="checkbox" name="whatsappEnabled" defaultChecked={settings.whatsappEnabled} className="h-4 w-4" />
            Send WhatsApp notifications
          </label>
          <div className="space-y-1.5">
            <Label htmlFor="whatsappSenderMode">Sender owner</Label>
            <select
              id="whatsappSenderMode"
              name="whatsappSenderMode"
              className={selectCls}
              defaultValue={settings.whatsappSenderMode}
            >
              <option value="company">Company-managed sender</option>
              <option value="platform_managed">Platform-managed sender (support add-on)</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="whatsappProvider">WhatsApp provider</Label>
            <select
              id="whatsappProvider"
              name="whatsappProvider"
              className={selectCls}
              defaultValue={settings.whatsappProvider}
            >
              <option value="disabled">Disabled</option>
              <option value="meta_cloud">Meta Cloud API</option>
              <option value="twilio">Twilio WhatsApp</option>
            </select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="whatsappRecipients">WhatsApp recipient numbers</Label>
            <Textarea
              id="whatsappRecipients"
              name="whatsappRecipients"
              rows={3}
              defaultValue={settings.whatsappRecipients.join('\n')}
              placeholder="+447700900123"
            />
          </div>
          <div className="rounded-md border p-4 sm:col-span-2">
            <h3 className="text-sm font-semibold">Meta Cloud API credentials</h3>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
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
          </div>
          <div className="rounded-md border p-4 sm:col-span-2">
            <h3 className="text-sm font-semibold">Twilio WhatsApp credentials</h3>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
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
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold">Slack and Webhook</h2>
          <p className="text-sm text-muted-foreground">
            Optional team alerts and system-to-system delivery for automation tools.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
            <input type="checkbox" name="slackEnabled" defaultChecked={settings.slackEnabled} className="h-4 w-4" />
            Send Slack notifications
          </label>
          <div className="space-y-1.5">
            <Label htmlFor="slackWebhookUrl">Slack incoming webhook</Label>
            <Input
              id="slackWebhookUrl"
              name="slackWebhookUrl"
              type="url"
              placeholder={settings.hasSlackWebhook ? 'Saved. Leave blank to keep.' : 'https://hooks.slack.com/...'}
            />
          </div>
          <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
            <input type="checkbox" name="webhookEnabled" defaultChecked={settings.webhookEnabled} className="h-4 w-4" />
            Send generic webhook
          </label>
          <div className="space-y-1.5">
            <Label htmlFor="genericWebhookUrl">Webhook URL</Label>
            <Input
              id="genericWebhookUrl"
              name="genericWebhookUrl"
              type="url"
              placeholder={settings.hasGenericWebhookUrl ? 'Saved. Leave blank to keep.' : 'https://example.com/webhook'}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="genericWebhookSecret">Webhook signing secret</Label>
            <Input
              id="genericWebhookSecret"
              name="genericWebhookSecret"
              type="password"
              placeholder={settings.hasGenericWebhookSecret ? 'Saved. Leave blank to keep.' : 'Optional'}
            />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold">Event rules</h2>
          <p className="text-sm text-muted-foreground">
            Choose which events go to each channel.
          </p>
        </div>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Event</th>
                {DELIVERY_CHANNELS.map((channel) => (
                  <th key={channel.key} className="px-3 py-2 text-left font-medium">{channel.label}</th>
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
