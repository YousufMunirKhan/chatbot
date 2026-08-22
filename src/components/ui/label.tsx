import * as React from 'react';
import { cn } from '@/lib/utils';

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  /**
   * Marks the field as required. Renders the asterisk that 11 labels currently
   * hand-type into their own text (Module 22). The glyph is `aria-hidden`
   * because the control itself carries the real `required` attribute, and a
   * screen reader announcing "star" adds nothing over "required".
   */
  required?: boolean;
}

const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, required, children, ...props }, ref) => (
    <label
      ref={ref}
      className={cn('text-sm font-medium leading-none', className)}
      {...props}
    >
      {children}
      {required ? (
        <span aria-hidden="true" className="ms-0.5 text-danger-fg">
          *
        </span>
      ) : null}
    </label>
  ),
);
Label.displayName = 'Label';

export { Label };
