'use strict';

const { baseUrl, unwrap } = require('../utils');

/**
 * Send a message — into an existing conversation, or to start a new one.
 *
 * `POST /api/v1/messages` writes the message first and reports delivery
 * separately, so a Zap can see what was said even when the channel provider
 * refused it. Those two facts are surfaced as `delivery__delivered` and
 * `delivery__reason` rather than being flattened away, because "the Zap ran and
 * the customer heard nothing" is a failure a person needs to be able to filter
 * on.
 */
const perform = async (z, bundle) => {
  const { conversation_id: conversationId, channel, to, text } = bundle.inputData;

  if (!conversationId && !(channel && to)) {
    throw new z.errors.Error(
      'Give either a Conversation ID, or both a Channel and a To address to start a new conversation.',
      'InvalidData',
      400,
    );
  }

  const body = { text };
  if (conversationId) body.conversation_id = conversationId;
  if (channel) body.channel = channel;
  if (to) body.to = to;

  const response = await z.request({
    url: `${baseUrl(bundle)}/api/v1/messages`,
    method: 'POST',
    body,
  });
  return unwrap(response);
};

module.exports = {
  key: 'send_message',
  noun: 'Message',
  display: {
    label: 'Send Message',
    description:
      'Sends a message into an existing conversation, or starts a conversation on a channel.',
  },
  operation: {
    inputFields: [
      {
        key: 'conversation_id',
        label: 'Conversation ID',
        type: 'string',
        required: false,
        helpText:
          'Reply inside an existing conversation. Leave empty and fill in Channel and To instead to start a new one.',
      },
      {
        key: 'channel',
        label: 'Channel',
        type: 'string',
        required: false,
        choices: {
          web_chat: 'Web chat',
          whatsapp: 'WhatsApp',
          instagram: 'Instagram',
          facebook: 'Facebook',
          telegram: 'Telegram',
          viber: 'Viber',
          line: 'LINE',
          email: 'Email',
          api: 'API',
        },
        helpText: 'Only needed when starting a new conversation.',
      },
      {
        key: 'to',
        label: 'To',
        type: 'string',
        required: false,
        helpText:
          'Who to send to on that channel: a phone number for WhatsApp, a page-scoped id for Facebook, an email address for email.',
      },
      {
        key: 'text',
        label: 'Message',
        type: 'text',
        required: true,
        helpText: 'Up to 4000 characters.',
      },
    ],
    perform,
    outputFields: [
      { key: 'id', label: 'Message ID' },
      { key: 'conversation_id', label: 'Conversation ID' },
      { key: 'channel', label: 'Channel' },
      { key: 'sender_type', label: 'Sender type' },
      { key: 'content_text', label: 'Message' },
      { key: 'created_at', label: 'Sent at' },
      { key: 'delivery__delivered', label: 'Delivered', type: 'boolean' },
      { key: 'delivery__transport', label: 'Delivered by' },
      { key: 'delivery__reason', label: 'Delivery problem' },
    ],
    sample: {
      id: 'c41b7a55-0000-4000-8000-000000000000',
      conversation_id: '2b7d0c11-0000-4000-8000-000000000000',
      channel: 'whatsapp',
      sender_type: 'agent',
      sender_id: 'api_key:0f2e7c31-0000-4000-8000-000000000000',
      content_text: 'Your order is on its way.',
      content_type: 'text',
      language: 'en',
      created_at: '2026-01-01T09:05:00.000Z',
      delivery: { delivered: true, transport: 'channel', reason: null },
    },
  },
};
