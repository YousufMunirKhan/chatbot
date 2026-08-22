import * as React from 'react';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  title: React.ReactNode;
  /** One or two sentences saying what would appear here, or how to fill it. */
  body?: React.ReactNode;
  /** Usually the `Button` that creates the first record. */
  action?: React.ReactNode;
  /** Decorative glyph above the title. */
  icon?: React.ReactNode;
  className?: string;
}

/**
 * "Nothing here yet" block (Module 22).
 *
 * Sized to drop straight into a `CardContent` — matches the vertical rhythm the
 * module placeholder already uses (`py-8 text-center`), so an empty table and a
 * not-yet-built page read as the same kind of pause rather than two designs.
 *
 * The title is a `<p>`, not a heading: an empty state is a state of the section
 * it sits in, and giving it its own outline entry would announce a section that
 * has no content.
 */
export function EmptyState({ title, body, action, icon, className }: EmptyStateProps) {
  return (
    <div className={cn('space-y-3 py-8 text-center', className)}>
      {icon ? (
        <div aria-hidden="true" className="flex justify-center text-muted-foreground">
          {icon}
        </div>
      ) : null}
      <p className="text-sm font-medium">{title}</p>
      {body ? <p className="mx-auto max-w-md text-sm text-muted-foreground">{body}</p> : null}
      {action ? <div className="flex justify-center gap-2 pt-1">{action}</div> : null}
    </div>
  );
}
