'use client';

import * as React from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';

/**
 * Buttons that hand the customer over to a Stripe-hosted page.
 *
 * Both do the same three things — ask this server for a one-time URL, follow
 * it, and show the reason if there is not one — so they share the hook below
 * rather than the page repeating the fetch-and-redirect dance four times.
 *
 * The URL is minted server-side per click and expires; it is never rendered
 * into the HTML, so a portal link cannot be copied out of the page source or
 * shared by someone who should not have it.
 */

type StripeApiResponse = {
  url?: string;
  // Two shapes reach this code: the routes' own `{ error: 'sentence' }` for a
  // failure they can explain, and `handleApiError`'s `{ error: { message } }`
  // for anything thrown. Reading only one of them is how a real error becomes
  // "Something went wrong".
  error?: string | { message?: string };
};

function readError(payload: StripeApiResponse, fallback: string): string {
  if (typeof payload.error === 'string') return payload.error;
  if (payload.error?.message) return payload.error.message;
  return fallback;
}

function useStripeRedirect(endpoint: string, body?: Record<string, unknown>) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const go = React.useCallback(async () => {
    setError(null);
    setPending(true);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      const payload = (await res.json().catch(() => ({}))) as StripeApiResponse;
      if (payload.url) {
        window.location.href = payload.url;
        // Stay disabled: the navigation is in flight, and re-enabling the
        // button here just invites a second session to be created.
        return;
      }
      setError(readError(payload, 'Could not open the billing page.'));
    } catch {
      setError('Could not reach the billing service. Check your connection and try again.');
    }
    setPending(false);
  }, [endpoint, body]);

  return { pending, error, go };
}

export interface BillingPortalButtonProps extends Omit<ButtonProps, 'onClick' | 'type'> {
  /**
   * Deep-link into one portal task. Left out, the customer lands on the portal
   * home, which is the right target for "manage everything".
   */
  flow?: 'payment_method_update' | 'subscription_update' | 'subscription_cancel';
  children: React.ReactNode;
}

export function BillingPortalButton({ flow, children, disabled, ...props }: BillingPortalButtonProps) {
  const body = React.useMemo(() => (flow ? { flow } : {}), [flow]);
  const { pending, error, go } = useStripeRedirect('/api/company/billing/portal', body);

  return (
    <span className="inline-flex flex-col items-start gap-1">
      {/* `disabled` is combined rather than spread over: a caller passing
          `disabled={false}` must not re-enable the button mid-request and mint
          a second portal session. */}
      <Button type="button" onClick={go} disabled={pending || disabled} aria-busy={pending} {...props}>
        {pending ? 'Opening Stripe…' : children}
      </Button>
      {error ? (
        <span role="alert" className="text-xs text-danger-fg">
          {error}
        </span>
      ) : null}
    </span>
  );
}

export interface AddPaymentMethodButtonProps extends Omit<ButtonProps, 'onClick' | 'type'> {
  children?: React.ReactNode;
}

/**
 * Save a card on Stripe's hosted form and come back with it already selected
 * for automatic top-up. Replaces the field that used to ask for a `pm_…` id.
 */
export function AddPaymentMethodButton({ children, disabled, ...props }: AddPaymentMethodButtonProps) {
  const { pending, error, go } = useStripeRedirect('/api/company/billing/payment-methods');

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button type="button" onClick={go} disabled={pending || disabled} aria-busy={pending} {...props}>
        {pending ? 'Opening Stripe…' : (children ?? 'Add a card')}
      </Button>
      {error ? (
        <span role="alert" className="text-xs text-danger-fg">
          {error}
        </span>
      ) : null}
    </span>
  );
}
