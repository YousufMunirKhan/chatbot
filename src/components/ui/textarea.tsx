import * as React from 'react';
import { cn } from '@/lib/utils';
import { CONTROL_BASE } from './control-styles';

/**
 * Multi-line text control (Module 22; resize and error state, Module 24).
 *
 * ## `resize-y`, not the browser default
 *
 * A textarea is resizable in BOTH directions by default, and the user's drag is
 * an inline `width` in pixels that beats every class on the element. Widen one
 * inside a card and it overflows the card, which overflows the grid column,
 * which gives the whole page a horizontal scrollbar — and it stays that way
 * until the element is destroyed, because nothing in the layout can win against
 * an inline style. Vertical resizing is the part people actually want (a longer
 * answer needs more lines, never more column), so that is the part that stays.
 *
 * ## Height
 *
 * `min-h-[80px]` is a floor, not a size. `rows` still works and is the right
 * way to ask for a taller box; the floor only stops a `rows={1}` textarea from
 * collapsing to something you cannot aim at.
 *
 * It has no `size` variant on purpose. The 36px/40px scale in
 * `control-styles.ts` is about lining a control up with the button beside it in
 * a toolbar, and a multi-line box is never in that row.
 */
const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(CONTROL_BASE, 'min-h-[80px] resize-y py-2', className)}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export { Textarea };
