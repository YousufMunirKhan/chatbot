'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface CopyFieldProps {
  /** The exact text that goes on the clipboard, and the text shown. */
  value: string;
  /** Visible label above the value. Also names the copy button. */
  label?: React.ReactNode;
  /**
   * `line` — one value on one line: a webhook URL, an API key, an agent link.
   * `block` — a snippet with its own line breaks: the widget embed script.
   */
  variant?: 'line' | 'block';
  /** Overrides the button's resting word. Defaults to "Copy". */
  copyLabel?: string;
  /** One line under the field, for what to do with the value. */
  hint?: React.ReactNode;
  className?: string;
}

/**
 * A value the user has to get out of the product and into somewhere else
 * (Module 24).
 *
 * ## Why this exists
 *
 * Eight screens show a value with a copy button beside it, and they agree on
 * nothing. Three surfaces: `rounded-md bg-muted px-3 py-2 text-sm` on the agent
 * link, `rounded bg-muted px-2 py-1` on the channel webhooks, `rounded
 * bg-background px-2 py-1` inside the channel form. Two overflow strategies:
 * `truncate`, which hides the end of a URL the user is about to paste somewhere
 * that needs all of it, and `overflow-auto`, which does not. And the API key
 * screen, the embed snippet and the mobile kit each lay the row out differently
 * again.
 *
 * ## The two bugs it fixes, not just the inconsistency
 *
 * **1. A failed copy looked exactly like a successful one.** `CopyButton`
 * catches the clipboard rejection and does nothing with it — the comment says
 * `/* clipboard unavailable *\/`. `navigator.clipboard` is undefined outside a
 * secure context and rejects outright when the document is not focused or the
 * permission is denied. The user pressed Copy, saw "Copy", pasted the last thing
 * they had copied an hour ago, and had no way to know. Here a failure says so
 * and selects the text, so Ctrl+C still works.
 *
 * **2. Nothing was announced.** The button's label flipped from "Copy" to
 * "Copied!" — a silent visual change to a control a screen-reader user has just
 * activated and moved past. The result now lives in a `role="status"` region.
 *
 * ## Selecting the value
 *
 * A user who does not trust a copy button will select the text by hand, so the
 * value must be selectable and must not be truncated with an ellipsis — that is
 * the one presentation from which the whole value cannot be recovered. A long
 * value scrolls inside its own box instead. The box is `tabIndex={0}` because it
 * is a scroll container that would otherwise be unreachable from the keyboard,
 * and it has a real accessible name, so the tab stop is not an unexplained one.
 */
export function CopyField({
  value,
  label,
  variant = 'line',
  copyLabel = 'Copy',
  hint,
  className,
}: CopyFieldProps) {
  const [state, setState] = React.useState<'idle' | 'copied' | 'failed'>('idle');
  const valueRef = React.useRef<HTMLElement | null>(null);
  // A callback ref, not `useRef` passed straight through: the same ref serves a
  // `<code>` and a `<pre>`, and a `RefObject<HTMLElement>` is not assignable to
  // `<pre>`'s `Ref<HTMLPreElement>`. A callback that accepts the supertype is.
  const setValueRef = React.useCallback((node: HTMLElement | null) => {
    valueRef.current = node;
  }, []);
  const labelId = React.useId();
  const timer = React.useRef<ReturnType<typeof setTimeout>>();

  React.useEffect(() => () => clearTimeout(timer.current), []);

  const settle = (next: 'copied' | 'failed') => {
    setState(next);
    clearTimeout(timer.current);
    // Long enough to read, and long enough that a screen reader's polite queue
    // reaches it before it is replaced.
    timer.current = setTimeout(() => setState('idle'), 4000);
  };

  const selectValue = () => {
    const node = valueRef.current;
    if (!node || typeof window === 'undefined') return;
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const copy = async () => {
    try {
      // Checked, not assumed. Outside a secure context — an IP address during
      // testing, plain http on a customer's staging box — `navigator.clipboard`
      // is `undefined`, so a bare `navigator.clipboard.writeText(…)` throws a
      // TypeError synchronously instead of returning a promise that rejects.
      const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
      if (!clipboard) throw new Error('Clipboard API unavailable');
      await clipboard.writeText(value);
      settle('copied');
    } catch {
      // Selecting the text turns a dead end into a two-key job, and is the only
      // thing that still works when the browser will not give up the clipboard.
      selectValue();
      settle('failed');
    }
  };

  const accessibleName = label ? `${copyLabel} ${typeof label === 'string' ? label : ''}`.trim() : copyLabel;

  const valueBox = cn(
    'min-w-0 select-all rounded-md border bg-muted/50 px-3 py-2 font-mono text-xs text-foreground',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    variant === 'line'
      ? // One line, scrolling. NOT `truncate`: an ellipsis is the one treatment
        // from which the user cannot recover the value by hand, and these are
        // values — webhook URLs, API keys — that are useless in part.
        'flex-1 overflow-x-auto whitespace-nowrap'
      : // A snippet keeps its own line breaks and scrolls sideways rather than
        // rewrapping code the user is about to paste.
        'w-full overflow-x-auto whitespace-pre leading-relaxed',
  );

  return (
    <div className={cn('space-y-1.5', className)}>
      {label ? (
        <p id={labelId} className="text-sm font-medium leading-tight">
          {label}
        </p>
      ) : null}

      <div
        className={cn(
          'flex gap-2',
          // The line variant is a row; the block variant puts the button under
          // the snippet, because a snippet is tall and a button pinned beside it
          // floats in the middle of nothing.
          variant === 'line' ? 'items-center' : 'flex-col items-start',
        )}
      >
        {variant === 'line' ? (
          <code
            ref={setValueRef}
            tabIndex={0}
            aria-labelledby={label ? labelId : undefined}
            className={valueBox}
          >
            {value}
          </code>
        ) : (
          <pre
            ref={setValueRef}
            tabIndex={0}
            aria-labelledby={label ? labelId : undefined}
            className={valueBox}
          >
            {value}
          </pre>
        )}

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={copy}
          aria-label={accessibleName}
          className="shrink-0"
        >
          {state === 'copied' ? 'Copied' : state === 'failed' ? 'Select it' : copyLabel}
        </Button>
      </div>

      {/*
        ONE region for both outcomes, rendered unconditionally and hidden while
        empty. A live region has to be in the DOM before the text lands in it —
        assistive tech watches regions it already knows about, and a `<p>` that
        appears at the same moment as its content is frequently not announced at
        all. `polite`, not `alert`: the user pressed a button and is waiting for
        the answer, so there is nothing to interrupt.
      */}
      <p
        role="status"
        aria-live="polite"
        className={cn(
          'text-xs empty:hidden',
          state === 'failed' ? 'text-danger-fg' : 'text-success-fg',
        )}
      >
        {state === 'copied'
          ? 'Copied to your clipboard.'
          : state === 'failed'
            ? 'Your browser would not let us use the clipboard. The text is selected — press Ctrl+C, or Cmd+C on a Mac.'
            : null}
      </p>

      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
