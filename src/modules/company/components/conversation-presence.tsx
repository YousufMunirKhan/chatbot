'use client';

import { useEffect, useState } from 'react';
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
    <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      ⚠️ <strong>{otherViewer}</strong> is also viewing this conversation. Coordinate before replying to avoid
      double responses.
    </div>
  );
}
