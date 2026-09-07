'use strict';

const { restHookTrigger } = require('../utils');

/**
 * Fires the moment someone leaves their details, whichever way they left them:
 * the chat assistant, the pre-chat form, a quick action, a guided flow, or your
 * own systems through the API. That is why it listens to `enquiry.created`
 * rather than the older `lead.created`, which only some of those paths raise.
 */
module.exports = restHookTrigger({
  key: 'new_enquiry',
  noun: 'Enquiry',
  label: 'New Enquiry',
  description:
    'Triggers when a visitor leaves their details — from the chat, a pre-chat form, a quick action or the API.',
  event: 'enquiry.created',
  outputFields: [
    { key: 'id', label: 'Enquiry ID' },
    { key: 'name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'enquiry_type', label: 'Enquiry type' },
    { key: 'message', label: 'Message' },
    { key: 'source', label: 'Source' },
    { key: 'source_page', label: 'Page they were on' },
    { key: 'status', label: 'Status' },
    { key: 'conversation_id', label: 'Conversation ID' },
    { key: 'created_at', label: 'Created at' },
  ],
  sample: {
    id: '9f1c4e2a-0000-4000-8000-000000000000',
    name: 'Sample Person',
    email: 'person@example.com',
    phone: null,
    enquiry_type: 'Quote',
    message: 'Do you deliver on Saturdays?',
    source: 'chat',
    source_page: '/pricing',
    status: 'new',
    conversation_id: '2b7d0c11-0000-4000-8000-000000000000',
    created_at: '2026-01-01T09:00:00.000Z',
  },
});
