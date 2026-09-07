'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * The browser half of phone alerts, shared by the settings card and the inbox
 * prompt so there is exactly one implementation of the permission dance.
 *
 * Nothing here runs on first paint beyond a capability check and a read of the
 * existing subscription. `Notification.requestPermission()` is only ever called
 * from `enable()`, i.e. from a click — browsers permanently block the site if
 * you ask on load, and a permission prompt the user did not ask for is denied
 * far more often than it is granted.
 */

export type PushState =
  | 'loading'
  /** No service worker or PushManager (old browser, private window). */
  | 'unsupported'
  /** iOS Safari: push exists only once the site is added to the Home Screen. */
  | 'needs-home-screen'
  /** VAPID keys are not set on the server, so nothing can be delivered. */
  | 'not-configured'
  /** Supported and available, permission not yet asked for. */
  | 'available'
  /** The user said no. Only they can undo this, in browser settings. */
  | 'denied'
  /** Permission granted and this device is registered. */
  | 'subscribed';

export interface UsePushSubscription {
  state: PushState;
  error: string | null;
  busy: boolean;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
}

/**
 * `applicationServerKey` wants raw bytes, and the VAPID public key arrives as
 * base64url. The explicit `ArrayBuffer` is not decoration: TypeScript's DOM
 * types require an ArrayBuffer-backed view here, and a bare `Uint8Array` is
 * typed as possibly SharedArrayBuffer-backed.
 */
function base64UrlToBytes(value: string): ArrayBuffer {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return buffer;
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

/**
 * Standalone means "launched from the Home Screen / installed", which is the
 * only mode where iOS grants push. `navigator.standalone` is the legacy iOS
 * flag; the media query covers everything else.
 */
function isStandalone(): boolean {
  const legacy = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  return Boolean(legacy) || window.matchMedia('(display-mode: standalone)').matches;
}

export function usePushSubscription(): UsePushSubscription {
  const [state, setState] = useState<PushState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function detect() {
      if (
        typeof window === 'undefined' ||
        !('serviceWorker' in navigator) ||
        !('PushManager' in window) ||
        !('Notification' in window)
      ) {
        // iOS below 16.4 has no PushManager at all; say the useful thing rather
        // than "unsupported", because adding to the Home Screen may fix it.
        if (typeof window !== 'undefined' && isIos() && !isStandalone()) {
          if (!cancelled) setState('needs-home-screen');
          return;
        }
        if (!cancelled) setState('unsupported');
        return;
      }
      if (isIos() && !isStandalone()) {
        if (!cancelled) setState('needs-home-screen');
        return;
      }

      try {
        const res = await fetch('/api/push/subscribe');
        const body = (await res.json()) as { configured?: boolean; publicKey?: string | null };
        if (cancelled) return;
        if (!body.configured || !body.publicKey) {
          setState('not-configured');
          return;
        }
        setPublicKey(body.publicKey);

        if (Notification.permission === 'denied') {
          setState('denied');
          return;
        }
        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        if (cancelled) return;
        setState(existing && Notification.permission === 'granted' ? 'subscribed' : 'available');
      } catch {
        if (!cancelled) setState('unsupported');
      }
    }

    void detect();
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      if (!publicKey) throw new Error('Phone alerts are not configured on the server.');
      const permission = await Notification.requestPermission();
      if (permission === 'denied') {
        setState('denied');
        return;
      }
      if (permission !== 'granted') return;

      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          // Required by every browser: a push may never be silent.
          userVisibleOnly: true,
          applicationServerKey: base64UrlToBytes(publicKey),
        }));

      const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: json.endpoint ?? subscription.endpoint,
          keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
        }),
      });
      if (!res.ok) throw new Error('Could not save this device. Please try again.');
      setState('subscribed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not turn phone alerts on.');
    } finally {
      setBusy(false);
    }
  }, [publicKey]);

  const disable = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        // Tell the server first: if unsubscribing locally succeeded but the
        // delete did not, we would keep pushing to a dead endpoint until the
        // push service returned 410.
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setState('available');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not turn phone alerts off.');
    } finally {
      setBusy(false);
    }
  }, []);

  return { state, error, busy, enable, disable };
}
