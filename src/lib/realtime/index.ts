/**
 * Realtime layer (Module 11).
 *
 * Thin wrapper over Supabase Realtime for the business inbox and live human
 * takeover: visitor message notifications, agent reply delivery, typing
 * indicators, unread counts, and AI/human status changes.
 */
export type RealtimeEvent =
  | 'visitor_message'
  | 'agent_reply'
  | 'typing'
  | 'unread_update'
  | 'status_change';

/** Channel name convention keeps subscriptions tenant-isolated. */
export function conversationChannel(companyId: string, conversationId: string): string {
  return `company:${companyId}:conversation:${conversationId}`;
}

export function inboxChannel(companyId: string): string {
  return `company:${companyId}:inbox`;
}
