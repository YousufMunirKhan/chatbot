'use client';

import { useEffect, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { pingConversationViewAction } from '../inbox-actions';

/**
 * Lightweight collision detection. Pings the server on mount and every 20s to
 * claim "I'm viewing this", and surfaces a banner if another agent was active
 * here in the last 45s — so two people don't reply over each other.
 */
export function ConversationPresence({ conversationId }: { conversationId: string }) {
  const [otherViewer, setOtherViewer] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function ping() {
      try {
        const res = await pingConversationViewAction(conversationId);
        if (active) setOtherViewer(res.otherViewer);
      } catch {
        /* presence is best-effort */
      }
    }
    ping();
    const timer = setInterval(ping, 20000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [conversationId]);

  if (!otherViewer) return null;
  return (
    // `border-amber-300 bg-amber-50 text-amber-900` was three raw palette
    // values that do not exist in dark mode — on a dark inbox this note was
    // near-black text on a pale yellow plate. `Alert tone="warning"` is the
    // same look on tokens that are defined and contrast-checked in both
    // themes. The emoji is gone: it was the only thing carrying the "this is a
    // warning" signal, and it is not read out as one.
    <Alert tone="warning">
      <strong>{otherViewer}</strong> is also viewing this conversation. Agree who is replying
      before you type, so the customer does not get two answers.
    </Alert>
  );
}
