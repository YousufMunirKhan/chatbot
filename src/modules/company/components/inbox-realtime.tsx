'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/db/client';

/**
 * Refreshes server-rendered inbox views when conversation state or messages
 * change. With a conversation id it watches one thread; without one it watches
 * the company inbox list.
 */
export function InboxRealtime({
  conversationId,
  companyId,
}: {
  conversationId?: string;
  companyId?: string;
}) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const refresh = () => router.refresh();
    const companyFilter = companyId ? { filter: `company_id=eq.${companyId}` } : {};
    const channel = supabase.channel(
      conversationId ? `inbox:${conversationId}` : `company-inbox:${companyId ?? 'all'}`,
    );

    if (conversationId) {
      channel
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            filter: `conversation_id=eq.${conversationId}`,
          },
          refresh,
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'conversations',
            filter: `id=eq.${conversationId}`,
          },
          refresh,
        );
    } else {
      channel
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'conversations',
            ...companyFilter,
          },
          refresh,
        )
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            ...companyFilter,
          },
          refresh,
        );
    }

    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [companyId, conversationId, router]);

  return null;
}
