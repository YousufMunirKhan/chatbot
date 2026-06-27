import type { IncomingMessage } from 'node:http';
import type { ChatRealtimeEvent } from './types';

export interface CustomWebSocketServerConfig {
  port: number;
  path?: string;
  authSecret: string;
}

export interface CustomWebSocketHub {
  publish(conversationId: string, event: ChatRealtimeEvent): void;
  close(): Promise<void>;
}

/**
 * Blueprint for a future standalone WebSocket service.
 *
 * This app currently uses Supabase Realtime + EventSource because it is cheaper
 * to operate and deploys cleanly on Next.js. When traffic requires a dedicated
 * socket tier, implement this hub in a separate Node process and point
 * `platform_settings.realtime.custom_ws_url` at it.
 */
export function createCustomWebSocketHub(_config: CustomWebSocketServerConfig): CustomWebSocketHub {
  return {
    publish(_conversationId: string, _event: ChatRealtimeEvent) {
      throw new Error('Custom WebSocket hub is not started in the Next.js app process.');
    },
    async close() {
      return;
    },
  };
}

export function authenticateSocketRequest(req: IncomingMessage, authSecret: string): boolean {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  return Boolean(token && authSecret && token === authSecret);
}
