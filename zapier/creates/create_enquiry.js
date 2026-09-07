'use strict';

const { baseUrl, unwrap } = require('../utils');

/**
 * Create an enquiry — the record the Customers screen shows and the assistant
 * captures. `POST /api/v1/contacts` is the endpoint; "contact" is what the API
 * has always called it and "enquiry" is what the people using Zapier call it,
 * so the label follows them and the docs say both.
 *
 * Typical Zap: a form on the marketing site, or a lead from an ad platform,
 * lands here so that everything a customer has ever asked sits in one list.
 */
const perform = async (z, bundle) => {
  const input = bundle.inputData;

  if (!input.name && !input.email && !input.phone) {
    throw new z.errors.Error(
      'An enquiry needs at least one of Name, Email or Phone.',
      'InvalidData',
      400,
    );
  }

  const body = { status: input.status || 'new' };
  ['name', 'email', 'phone', 'enquiry_type', 'message', 'source_page'].forEach((key) => {
    if (input[key]) body[key] = input[key];
  });

  const response = await z.request({
    url: `${baseUrl(bundle)}/api/v1/contacts`,
    method: 'POST',
    body,
  });
  return unwrap(response);
};

module.exports = {
  key: 'create_enquiry',
  noun: 'Enquiry',
  display: {
    label: 'Create Enquiry',
    description: 'Creates an enquiry (a contact record) in your account.',
  },
  operation: {
    inputFields: [
      { key: 'name', label: 'Name', type: 'string', required: false },
      { key: 'email', label: 'Email', type: 'string', required: false },
      { key: 'phone', label: 'Phone', type: 'string', required: false },
      {
        key: 'enquiry_type',
        label: 'Enquiry type',
        type: 'string',
        required: false,
        helpText: 'Your own wording — "Quote", "Support", "Booking".',
      },
      { key: 'message', label: 'Message', type: 'text', required: false },
      {
        key: 'source_page',
        label: 'Page',
        type: 'string',
        required: false,
        helpText: 'Where the enquiry came from, if you know it.',
      },
      {
        key: 'status',
        label: 'Status',
        type: 'string',
        required: false,
        default: 'new',
        choices: {
          new: 'New',
          contacted: 'Contacted',
          qualified: 'Qualified',
          converted: 'Converted',
          closed: 'Closed',
        },
      },
    ],
    perform,
    outputFields: [
      { key: 'id', label: 'Enquiry ID' },
      { key: 'name', label: 'Name' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'enquiry_type', label: 'Enquiry type' },
      { key: 'message', label: 'Message' },
      { key: 'source', label: 'Source' },
      { key: 'status', label: 'Status' },
      { key: 'created_at', label: 'Created at' },
    ],
    sample: {
      id: '9f1c4e2a-0000-4000-8000-000000000000',
      name: 'Sample Person',
      email: 'person@example.com',
      phone: null,
      enquiry_type: 'Quote',
      message: 'Do you deliver on Saturdays?',
      source: 'api',
      source_page: null,
      status: 'new',
      conversation_id: null,
      created_at: '2026-01-01T09:00:00.000Z',
    },
  },
};
