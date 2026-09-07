'use strict';

const { restHookTrigger, CONVERSATION_OUTPUT_FIELDS } = require('../utils');

/**
 * Fires when a conversation is closed, however it was closed — an agent
 * resolving it in the inbox, a ticket being marked done, or the assistant
 * finishing up. The event is raised from the conversation record itself, so no
 * closing path is missed.
 *
 * A common use: send the customer a satisfaction survey, or write the finished
 * conversation into a CRM as an activity.
 */
module.exports = restHookTrigger({
  key: 'conversation_closed',
  noun: 'Conversation',
  label: 'Conversation Closed',
  description: 'Triggers when a conversation is closed, by an agent or by the assistant.',
  event: 'conversation.closed',
  outputFields: CONVERSATION_OUTPUT_FIELDS,
  sample: {
    id: '2b7d0c11-0000-4000-8000-000000000000',
    channel: 'web_chat',
    status: 'closed',
    language: 'en',
    visitor_id: 'visitor_123',
    customer_id: null,
    assigned_agent_id: '6d2f8a90-0000-4000-8000-000000000000',
    ai_enabled: false,
    unread_count: 0,
    started_at: '2026-01-01T09:00:00.000Z',
    last_message_at: '2026-01-01T09:20:00.000Z',
    closed_at: '2026-01-01T09:21:00.000Z',
  },
});
