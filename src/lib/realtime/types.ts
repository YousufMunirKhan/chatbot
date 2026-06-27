export type ChatRealtimeEvent =
  | {
      type: 'message.created';
      conversationId: string;
      message: {
        id: string;
        sender_type: 'agent' | 'system' | 'ai' | 'visitor';
        content_text: string;
        created_at: string;
      };
    }
  | {
      type: 'conversation.updated';
      conversationId: string;
      status: string;
      aiEnabled: boolean;
      assignedAgentId?: string | null;
    }
  | { type: 'agent.typing'; conversationId: string; agentId: string }
  | { type: 'agent.joined'; conversationId: string; agentId?: string | null; agentName?: string | null }
  | { type: 'agent.left'; conversationId: string; agentId?: string | null }
  | { type: 'agent.presence.updated'; companyId: string; agentId: string; status: 'online' | 'away' | 'offline' };

export interface RealtimeSubscriber {
  close(): Promise<void> | void;
}

export interface VisitorRealtimeProvider {
  subscribeToConversation(params: {
    conversationId: string;
    onEvent: (event: ChatRealtimeEvent) => void;
    onError?: (error: unknown) => void;
  }): Promise<RealtimeSubscriber>;
}
