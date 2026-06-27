import { createSupabaseServiceClient } from '@/lib/db/server';
import type { ChatRealtimeEvent, RealtimeSubscriber, VisitorRealtimeProvider } from './types';

export class SupabaseVisitorRealtimeProvider implements VisitorRealtimeProvider {
  async subscribeToConversation(params: {
    conversationId: string;
    onEvent: (event: ChatRealtimeEvent) => void;
    onError?: (error: unknown) => void;
  }): Promise<RealtimeSubscriber> {
    const supabase = createSupabaseServiceClient();
    const channel = supabase
      .channel(`visitor-conversation:${params.conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${params.conversationId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          const senderType = row.sender_type as ChatRealtimeEvent extends infer _ ? string : string;
          if (!['agent', 'system'].includes(senderType)) return;
          params.onEvent({
            type: 'message.created',
            conversationId: params.conversationId,
            message: {
              id: row.id as string,
              sender_type: senderType as 'agent' | 'system',
              content_text: (row.content_text as string) ?? '',
              created_at: (row.created_at as string) ?? new Date().toISOString(),
            },
          });
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'conversations',
          filter: `id=eq.${params.conversationId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          params.onEvent({
            type: 'conversation.updated',
            conversationId: params.conversationId,
            status: (row.status as string) ?? 'ai_active',
            aiEnabled: Boolean(row.ai_enabled),
            assignedAgentId: (row.assigned_agent_id as string | null) ?? null,
          });
        },
      )
      .subscribe((status, error) => {
        if (error) params.onError?.(error);
        if (status === 'CHANNEL_ERROR') params.onError?.(new Error('Realtime channel error'));
      });

    return {
      async close() {
        await supabase.removeChannel(channel);
      },
    };
  }
}

export class CustomWebSocketVisitorRealtimeProvider implements VisitorRealtimeProvider {
  constructor(private readonly wsUrl: string) {}

  async subscribeToConversation(): Promise<RealtimeSubscriber> {
    if (!this.wsUrl) throw new Error('Custom WebSocket URL is not configured.');
    throw new Error('Custom WebSocket provider requires a separate Node/WebSocket service at ' + this.wsUrl);
  }
}

export function getVisitorRealtimeProvider(): VisitorRealtimeProvider {
  return new SupabaseVisitorRealtimeProvider();
}

export function getCustomWebSocketProvider(wsUrl: string): VisitorRealtimeProvider {
  return new CustomWebSocketVisitorRealtimeProvider(wsUrl);
}
