'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormMessage } from '@/components/ui/form-message';
import { forgetPushDeviceAction, sendTestPushAction, type PushActionState } from '../push-actions';
import type { PushDeviceRow } from '../push-data';
import { usePushSubscription } from './use-push-subscription';

/**
 * Phone alerts, told honestly.
 *
 * Every failure mode a user can hit is named rather than hidden behind a dead
 * toggle: an unsupported browser, a permission they already refused (which this
 * app cannot undo), an iPhone that has not been added to the Home Screen, and a
 * platform where the VAPID keys were never installed. A switch that silently
 * does nothing is worse than a sentence explaining why.
 */

const initial: PushActionState = {};

/**
 * A user-agent string is unreadable; this is enough to recognise your own
 * phone in a list. Lives here rather than in the data module because that
 * module is server-only and this is the only consumer.
 */
function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  const ua = userAgent.toLowerCase();
  const platform = ua.includes('iphone')
    ? 'iPhone'
    : ua.includes('ipad')
      ? 'iPad'
      : ua.includes('android')
        ? 'Android'
        : ua.includes('mac os')
          ? 'Mac'
          : ua.includes('windows')
            ? 'Windows'
            : 'Device';
  const browser = ua.includes('edg/')
    ? 'Edge'
    : ua.includes('chrome')
      ? 'Chrome'
      : ua.includes('firefox')
        ? 'Firefox'
        : ua.includes('safari')
          ? 'Safari'
          : 'Browser';
  return `${platform} · ${browser}`;
}

function TestButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending ? 'Sending…' : 'Send test notification'}
    </Button>
  );
}

export function PushAlertsCard({
  devices,
  companyDeviceCount,
  configured,
}: {
  devices: PushDeviceRow[];
  companyDeviceCount: number;
  configured: boolean;
}) {
  const push = usePushSubscription();
  const [testState, testAction] = useFormState(sendTestPushAction, initial);

  const state = configured ? push.state : 'not-configured';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Phone alerts</CardTitle>
        <CardDescription>
          Get a notification on your phone or desktop the moment a customer asks for a person, a
          lead comes in, or an order is placed — even when this tab is closed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {state === 'loading' ? (
          <p className="text-sm text-muted-foreground">Checking this device…</p>
        ) : null}

        {state === 'not-configured' ? (
          <Alert tone="warning" title="Not switched on for this platform">
            Phone alerts need push keys on the server (VAPID). Ask your administrator to set
            <code className="mx-1">VAPID_PUBLIC_KEY</code>,
            <code className="mx-1">VAPID_PRIVATE_KEY</code>
            and <code className="mx-1">VAPID_SUBJECT</code>. Nothing else on this page is affected.
          </Alert>
        ) : null}

        {state === 'unsupported' ? (
          <Alert tone="info" title="This browser cannot show alerts">
            Push notifications need a modern browser and a normal (not private) window. Try Chrome,
            Edge, Firefox, or Safari 16.4 and later.
          </Alert>
        ) : null}

        {state === 'needs-home-screen' ? (
          <Alert tone="info" title="On iPhone and iPad, add this to your Home Screen first">
            Apple only allows alerts for installed web apps. In Safari, tap <strong>Share</strong>,
            then <strong>Add to Home Screen</strong>, open the app from that icon, and this switch
            will appear. Alerts do not work in the normal Safari tab.
          </Alert>
        ) : null}

        {state === 'denied' ? (
          <Alert tone="warning" title="You blocked notifications for this site">
            We cannot ask again — browsers only allow that once. Re-allow notifications for this
            site in your browser settings (the icon at the start of the address bar), then reload
            this page.
          </Alert>
        ) : null}

        {state === 'available' ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-4">
            <div className="space-y-1">
              <p className="text-sm font-medium">Alerts are off on this device</p>
              <p className="text-xs text-muted-foreground">
                Your browser will ask for permission once. You can turn this off again at any time.
              </p>
            </div>
            <Button size="sm" onClick={() => void push.enable()} disabled={push.busy}>
              {push.busy ? 'Turning on…' : 'Turn on alerts'}
            </Button>
          </div>
        ) : null}

        {state === 'subscribed' ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-4">
            <div className="space-y-1">
              <p className="flex items-center gap-2 text-sm font-medium">
                Alerts are on for this device <Badge variant="success">On</Badge>
              </p>
              <p className="text-xs text-muted-foreground">
                You will be alerted about handoff requests, new leads, new orders, and reply-time
                warnings. Choose exactly which in the grid below.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <form action={testAction}>
                <TestButton />
              </form>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void push.disable()}
                disabled={push.busy}
              >
                Turn off
              </Button>
            </div>
          </div>
        ) : null}

        {push.error ? <FormMessage state={{ error: push.error }} /> : null}
        <FormMessage state={testState} okText={testState.okText ?? 'Sent.'} />

        {devices.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Your devices</p>
            <ul className="divide-y rounded-md border">
              {devices.map((device) => {
                const name = describeDevice(device.userAgent);
                return (
                  <li key={device.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0 text-sm">
                      {name}
                      {device.failedCount > 0 ? (
                        <span className="ms-2 text-xs text-muted-foreground">
                          {device.failedCount} failed attempt{device.failedCount === 1 ? '' : 's'}
                        </span>
                      ) : null}
                    </span>
                    <form action={forgetPushDeviceAction}>
                      <input type="hidden" name="subscriptionId" value={device.id} />
                      {/* "Forget" named nothing, and out of context — a screen
                          reader listing the buttons on this card — every row
                          read identically. The visible text says what stops;
                          aria-label adds which device, since the name is only
                          in the neighbouring span. */}
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        aria-label={`Stop alerts on ${name} — this device is removed and stops receiving notifications`}
                      >
                        Stop alerts on this device
                      </Button>
                    </form>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {companyDeviceCount > 0 ? (
          <p className="text-xs text-muted-foreground">
            {companyDeviceCount} device{companyDeviceCount === 1 ? '' : 's'} across your team are
            set up for alerts.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
