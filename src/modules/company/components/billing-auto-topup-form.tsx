'use client';

import * as React from 'react';
import { useFormState } from 'react-dom';
import { Alert } from '@/components/ui/alert';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { SubmitButton } from '@/components/ui/submit-button';
import type { AutoTopUpConfig } from '@/lib/billing/auto-topup';
import { cardHasExpired, describeCard, type CompanyCard } from '../billing-format';
import {
  saveBillingAutoTopUpAction,
  type ActionState as SaveState,
} from '../billing-auto-topup-actions';
import { runAutoTopUpNowAction, type ActionState as RunState } from '../auto-topup-actions';
import { AddPaymentMethodButton } from './billing-portal-button';
import { CHECKBOX, CHOICE_CARD, FIELD_GRID_NARROW } from './form-layout';

/**
 * Automatic top-up, with the card picked instead of typed.
 *
 * The field this replaces asked for a `pm_…` identifier. Nobody outside a
 * Stripe dashboard has one, so in practice the feature could not be switched on
 * by the customers it was built for. The list below is the cards Stripe holds
 * for this company, described the way they appear on a statement, and the
 * button beside it opens Stripe's own hosted form to add another. No card
 * number reaches this application at any point.
 */

const saveInitial: SaveState = {};
const runInitial: RunState = {};

export interface BillingAutoTopUpFormProps {
  config: AutoTopUpConfig | null;
  /** Current prepaid credit, so the threshold can be judged against something. */
  balance: number | null;
  /** Cards Stripe holds for this company. Empty when none are saved yet. */
  cards: CompanyCard[];
  /** False when the platform has no Stripe secret — nothing here can work. */
  stripeConfigured: boolean;
}

/** The pence value the server stores, from the pounds the customer typed. */
function toPence(pounds: string): string {
  const value = Math.round(Number(pounds) * 100);
  // A blank or malformed box submits 0, which the action rejects with the
  // minimum-amount message. Submitting "NaN" would produce a zod default that
  // says nothing useful.
  return Number.isFinite(value) && value > 0 ? String(value) : '0';
}

export function BillingAutoTopUpForm({
  config,
  balance,
  cards,
  stripeConfigured,
}: BillingAutoTopUpFormProps) {
  const [saveState, saveAction] = useFormState(saveBillingAutoTopUpAction, saveInitial);
  const [runState, runAction] = useFormState(runAutoTopUpNowAction, runInitial);

  const savedCardId = config?.stripePaymentMethodId ?? null;
  const savedCardIsListed = savedCardId != null && cards.some((card) => card.id === savedCardId);

  /**
   * The saved card kept as an option even when the list did not come back.
   *
   * Without this, a Stripe outage (or a card removed in the portal) would show
   * an empty picker, and saving an unrelated change to the threshold would
   * quietly clear the card the customer is relying on.
   */
  const options = React.useMemo(() => {
    const listed = cards.map((card) => ({
      id: card.id,
      expired: cardHasExpired(card),
      // An expired card is the commonest reason a top-up starts failing, and
      // the expiry date alone does not read as a problem at a glance.
      label:
        describeCard(card) +
        (card.isDefault ? ' · default' : '') +
        (cardHasExpired(card) ? ' · EXPIRED' : ''),
    }));
    if (savedCardId && !savedCardIsListed) {
      return [
        {
          id: savedCardId,
          expired: false,
          label: 'Card on file — Stripe could not confirm the details',
        },
        ...listed,
      ];
    }
    return listed;
  }, [cards, savedCardId, savedCardIsListed]);

  const savedCardExpired = cards.some((card) => card.id === savedCardId && cardHasExpired(card));

  const [amount, setAmount] = React.useState(((config?.topupAmountCents ?? 2000) / 100).toFixed(2));

  return (
    <div className="space-y-4">
      {!stripeConfigured ? (
        <Alert tone="warning" title="Card payments are not switched on yet">
          Automatic top-up needs Stripe, which this platform has not been given keys for. Contact
          support and they will turn it on.
        </Alert>
      ) : null}

      {config?.disabledReason ? (
        <Alert tone="warning" title="Automatic top-up stopped">
          {config.disabledReason}
        </Alert>
      ) : null}

      {savedCardId && !savedCardIsListed && cards.length > 0 ? (
        <Alert tone="warning" title="The card set for top-ups is no longer saved">
          It was probably removed in the Stripe portal. Pick another card below, or add one, or the
          next top-up will fail.
        </Alert>
      ) : null}

      {savedCardExpired ? (
        <Alert tone="warning" title="The card set for top-ups has expired">
          Add a replacement below. Stripe will decline the next top-up on this card, and three
          declines switch the feature off.
        </Alert>
      ) : null}

      <form action={saveAction} className="space-y-4">
        {/* The master switch, as a bordered target rather than a bare tick box:
            it is the one control on this card that decides whether any of the
            others do anything, and at 375px a 16px box beside a wrapping
            sentence is both hard to see and hard to hit. */}
        {/* This was `CHOICE_CARD`'s exact class string written out by hand,
            minus the `[&>input]:mt-0.5` that puts the box on the cap-height of
            the first line of a two-line label — so the one tick box on this
            card sat 2px high against its own text while every other choice card
            in the product sat right. Same treatment, taken from the constant. */}
        <label className={CHOICE_CARD}>
          <input
            type="checkbox"
            name="isEnabled"
            defaultChecked={config?.isEnabled ?? false}
            className={CHECKBOX}
          />
          <span>
            <span className="block font-medium">Top up automatically when my credit runs low</span>
            <span className="block text-xs text-muted-foreground">
              Off, your assistant simply stops replying once the credit runs out.
            </span>
          </span>
        </label>

        {/*
          WHY THESE ARE NOT ONE ROW OF THREE
          ----------------------------------
          They were `sm:grid-cols-3`, so from 640px upward the card picker got a
          third of the card's width and rendered options like
          "Visa •••• 4242 · default · EXPIRED" into roughly 180px. A `<select>`
          cannot wrap, so it clipped its own text — and the one word that
          mattered, EXPIRED, was the end of the string and therefore the part
          that disappeared.

          Two numbers with an obvious relationship ("below X, add Y") belong
          together on one line; the card is a different kind of answer and gets
          its own full-width row. `FIELD_GRID_NARROW` still collapses both
          numbers to one column on a phone.
        */}
        <div className={FIELD_GRID_NARROW}>
          <FormField
            label="Top up below (credits)"
            htmlFor="thresholdCredits"
            hint={balance == null ? undefined : `You have ${balance.toFixed(2)} now.`}
          >
            <Input
              id="thresholdCredits"
              name="thresholdCredits"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              defaultValue={config?.thresholdCredits ?? 5}
            />
          </FormField>

          <FormField
            label="Amount to add (£)"
            htmlFor="topupAmountDisplay"
            hint="Charged each time. Minimum £1."
          >
            {/* Submitted in pence alongside this box: the ledger and Stripe both
                count in the smallest unit, and converting on the server from a
                decimal string is where the one-penny rounding bugs come from. */}
            <Input
              id="topupAmountDisplay"
              type="number"
              min={1}
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.currentTarget.value)}
            />
          </FormField>
        </div>

        <FormField
          label="Card to charge"
          htmlFor="stripePaymentMethodId"
          hint={
            options.length === 0
              ? 'No card saved yet — add one below to switch this on.'
              : 'Saved on Stripe. This app never sees the card number.'
          }
        >
          <Select
            id="stripePaymentMethodId"
            name="stripePaymentMethodId"
            defaultValue={savedCardId ?? ''}
          >
            <option value="">No card — do not top up automatically</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
        </FormField>

        <input type="hidden" name="topupAmountCents" value={toPence(amount)} readOnly />

        <FormMessage state={saveState} okText="Automatic top-up saved." />
        <SubmitButton pendingLabel="Saving…">Save automatic top-up</SubmitButton>
      </form>

      {/* Outside the form on purpose. This button leaves the page for Stripe,
          so it must not read as another way to submit what is typed above —
          and a customer who presses it before saving should not believe their
          threshold went with them. */}
      <div className="flex flex-wrap items-start gap-3">
        <AddPaymentMethodButton variant="outline" disabled={!stripeConfigured}>
          {options.length === 0 ? 'Add a card' : 'Add another card'}
        </AddPaymentMethodButton>
        <p className="max-w-md text-xs text-muted-foreground">
          Opens Stripe&rsquo;s secure card form. The card comes back saved and selected here — save
          your settings first if you have unsaved changes above.
        </p>
      </div>

      <form action={runAction} className="space-y-2 border-t pt-4">
        <p className="text-sm text-muted-foreground">
          Runs the same check the platform runs. Nothing is charged if your balance is above the
          threshold.
        </p>
        {runState.message ? (
          <p role="status" aria-live="polite" className="text-sm text-success-fg">
            {runState.message}
          </p>
        ) : (
          <FormMessage state={runState} okText="Checked." />
        )}
        <SubmitButton variant="outline" pendingLabel="Checking…">
          Top up now
        </SubmitButton>
      </form>
    </div>
  );
}
