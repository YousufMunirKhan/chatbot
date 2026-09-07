'use strict';

const { restHookTrigger, CONVERSATION_OUTPUT_FIELDS } = require('../utils');

/** Every conversation, on every channel, the moment it starts. */
module.exports = restHookTrigger({
  key: 'new_conversation',
  noun: 'Conversation',
  label: 'New Conversation',
  description: 'Triggers when a customer starts a conversation on any channel.',
  event: 'conversation.created',
  outputFields: CONVERSATION_OUTPUT_FIELDS,
  sample: {
    id: '2b7d0c11-0000-4000-8000-000000000000',
    channel: 'web_chat',
    status: 'ai_active',
    language: 'en',
    visitor_id: 'visitor_123',
    customer_id: null,
    assigned_agent_id: null,
    ai_enabled: true,
    unread_count: 1,
    started_at: '2026-01-01T09:00:00.000Z',
    last_message_at: '2026-01-01T09:00:00.000Z',
    closed_at: null,
  },
});
