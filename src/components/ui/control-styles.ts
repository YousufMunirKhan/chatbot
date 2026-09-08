/**
 * The one size scale, shared by every form control (Module 24).
 *
 * ## The problem this file closes
 *
 * `Button` had four heights (h-10, h-9, h-11, h-10 square), `Select` had two
 * (h-10, h-9), `Input` had exactly one (h-10) and `Textarea` had none at all.
 * So a filter bar — search box, status dropdown, Filter button, Clear link —
 * could not line up, and the workaround was to stop using the primitive:
 * `src/modules/company/components/list-controls.tsx` carries a hand-written
 * `inputCls` whose own comment reads "the one control that could not adopt its
 * primitive", and `company/reports/page.tsx` hand-rolls two more at `h-9`.
 *
 * Two heights, and every control has both:
 *
 * | Size      | Height | Where                                                |
 * | --------- | -----: | ---------------------------------------------------- |
 * | `default` |   40px | Forms. A field you fill in deliberately.             |
 * | `sm`      |   36px | Toolbars and filter bars, beside `Button size="sm"`. |
 *
 * `Button`'s `lg` (44px) is not in this table on purpose: it is a page-level
 * call to action, never something you line a text field up against.
 *
 * ## Why strings and not `cva`
 *
 * No JSX and no `'use client'`, so this imports cleanly into server components,
 * client components and `tab-styles.ts`-style constant files alike — which is
 * what stops the two halves of a control drifting apart. Same reasoning as
 * `tab-styles.ts`.
 */

export type ControlSize = 'default' | 'sm';

/**
 * Everything a text control shares: the box, the border, the focus ring and the
 * error state. No height and no vertical padding — those come from
 * `CONTROL_SIZES`, so the two can never disagree.
 *
 * `border-input` rather than the decorative `border`: `--input` is held to 3:1
 * because the border is the only thing telling a user a control is there
 * (WCAG 1.4.11), while `--border` sits at 1.23:1 and is for card rules.
 *
 * `aria-invalid:*` is what makes an error visible as well as audible.
 * `FormField` sets `aria-invalid` on whatever control it wraps the moment it is
 * given an `error`, so this needs no opt-in at the call site. The variant is
 * registered in `tailwind.config.ts` — it is NOT one of Tailwind's built-in
 * nine `aria-*` variants, which is why writing `aria-invalid:` used to compile
 * to nothing at all.
 */
export const CONTROL_BASE = [
  'flex w-full rounded-md border border-input bg-background px-3 text-sm text-foreground',
  'ring-offset-background placeholder:text-muted-foreground',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
  'disabled:cursor-not-allowed disabled:opacity-50',
  'aria-invalid:border-danger aria-invalid:focus-visible:ring-danger',
].join(' ');

/** Height + vertical padding. Matches `Button`'s `default` and `sm` exactly. */
export const CONTROL_SIZES: Record<ControlSize, string> = {
  default: 'h-10 py-2',
  sm: 'h-9 py-1',
};
