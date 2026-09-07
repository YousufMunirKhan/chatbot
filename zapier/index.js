'use strict';

const { version: platformVersion } = require('zapier-platform-core');

const packageJson = require('./package.json');
const authentication = require('./authentication');
const { addBearerToken, handleApiErrors } = require('./middleware');

const newEnquiry = require('./triggers/new_enquiry');
const newConversation = require('./triggers/new_conversation');
const conversationClosed = require('./triggers/conversation_closed');
const newOrder = require('./triggers/new_order');

const sendMessage = require('./creates/send_message');
const createEnquiry = require('./creates/create_enquiry');

/**
 * The Zapier app.
 *
 * This directory is pushed to Zapier's platform with the Zapier CLI, not
 * deployed with the site — see `docs/ZAPIER.md`. It lives in this repository
 * because everything it talks to does: the triggers subscribe through
 * `/api/v1/hooks`, the deliveries come from the platform's own signed webhook
 * pipeline, and a change to either has to be made on both sides at once.
 *
 * One Zapier app is the cheapest integration coverage there is. It reaches
 * HubSpot, Salesforce, Pipedrive, Google Sheets and several thousand others,
 * which is precisely why this product has no native connectors for any of them.
 *
 * All four triggers are REST hooks, not polling: Zapier hands us a URL, we hand
 * it back an id, and events arrive as they happen instead of on a fifteen-minute
 * sweep that costs both sides a request every time nothing has changed.
 */
module.exports = {
  version: packageJson.version,
  platformVersion,

  authentication,

  beforeRequest: [addBearerToken],
  afterResponse: [handleApiErrors],

  triggers: {
    [newEnquiry.key]: newEnquiry,
    [newConversation.key]: newConversation,
    [conversationClosed.key]: conversationClosed,
    [newOrder.key]: newOrder,
  },

  creates: {
    [sendMessage.key]: sendMessage,
    [createEnquiry.key]: createEnquiry,
  },

  searches: {},
  resources: {},
};
