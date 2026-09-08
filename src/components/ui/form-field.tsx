import * as React from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export interface FormFieldProps {
  /** Visible label text. Always render one — placeholders are not labels. */
  label: React.ReactNode;
  /**
   * `id` of the control this labels. Also seeds the generated `${htmlFor}-hint`
   * and `${htmlFor}-error` ids, so it must match the control's own `id`.
   */
  htmlFor: string;
  required?: boolean;
  /** Standing help text. Shown whether or not the field is in error. */
  hint?: React.ReactNode;
  /** Validation failure. Its presence is what flips the field into the error state. */
  error?: React.ReactNode;
  /** The control itself — `Input`, `Textarea`, `Select`, or a bare element. */
  children: React.ReactNode;
  className?: string;
}

/**
 * Label + control + hint + error, wired together (Module 22).
 *
 * The codebase invented this twice independently — the local `Field` in
 * `src/modules/company/components/widget-design-studio.tsx` (label + children +
 * hint) and the one in the super-admin company detail page (label + children).
 * This is those two, plus the part both were missing: the accessible wiring.
 *
 * `aria-describedby` appears zero times in the repo today. Rather than ask every
 * call site to remember it, this component clones the child control and injects
 * a composed `aria-describedby` pointing at whichever of the hint and error
 * elements actually rendered, plus `aria-invalid` when `error` is set. A screen
 * reader user therefore hears the label, the help text and the failure reason
 * on focus, without any call site opting in.
 *
 * Any `aria-describedby` the child already carries is preserved and appended to
 * rather than clobbered.
 *
 * Layout matches the two local `Field`s exactly (`space-y-1.5`, `text-xs`
 * muted hint), so migrating a call site is a rename, not a redesign.
 *
 * ## Two constraints worth knowing before you reach for it
 *
 * **It wires exactly ONE element child.** A fragment, a string, or two controls
 * side by side are rendered untouched — no `id`, no `aria-describedby`, no
 * `aria-invalid` — so the field silently loses its wiring rather than throwing.
 * If you need a compound control (two selects making a date range, a radio set),
 * do not fake it with a wrapper `<div>`: a `<label htmlFor>` pointing at a `div`
 * labels nothing. Use a `<fieldset>` with a `<legend>`, which is what
 * `widget-design-studio.tsx` and `intents-panel.tsx` already worked out.
 *
 * **The error is what makes the control look wrong.** Passing `error` sets
 * `aria-invalid` on the child, and `Input`/`Textarea`/`Select` paint a red
 * border and a red focus ring off that attribute. Before Module 24 the variant
 * did not exist in the Tailwind config, so `error` announced the failure to a
 * screen reader and showed a sighted user nothing but a line of small red text
 * under a field that still looked perfectly fine.
 */
export function FormField({
  label,
  htmlFor,
  required,
  hint,
  error,
  children,
  className,
}: FormFieldProps) {
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  // Only a single element child can be wired up. Anything else (a fragment, a
  // string, several controls) is rendered untouched so the component degrades
  // to plain layout instead of throwing.
  const childProps = React.isValidElement(children)
    ? (children.props as Record<string, unknown>)
    : null;

  const control =
    React.isValidElement(children) && childProps
      ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
          id: (childProps.id as string | undefined) ?? htmlFor,
          'aria-invalid': error ? true : childProps['aria-invalid'],
          // `required` marks the label with an asterisk, which a screen reader
          // is told to ignore (it is `aria-hidden` — "star" is not a word anyone
          // needs). So the asterisk alone announced nothing at all. Mirroring it
          // onto the control is what makes "required" reach both audiences from
          // the single prop. A child that already states its own wins, so a form
          // using native `required` is unaffected.
          'aria-required':
            childProps['aria-required'] ??
            (Boolean(childProps['required']) || required ? true : undefined),
          'aria-describedby':
            [childProps['aria-describedby'] as string | undefined, describedBy]
              .filter(Boolean)
              .join(' ') || undefined,
        })
      : children;

  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor} required={required}>
        {label}
      </Label>
      {control}
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs font-medium text-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}
