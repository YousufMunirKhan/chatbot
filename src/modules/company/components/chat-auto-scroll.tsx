'use client';

import { useEffect, useRef } from 'react';

/**
 * Scrolls the message thread to the newest message on load and whenever a new
 * message arrives. Rendered as the last child inside the scrollable thread.
 */
export function ChatAutoScroll({ count }: { count: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'end' });
  }, [count]);
  return <div ref={ref} aria-hidden="true" />;
}
