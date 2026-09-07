'use strict';

const { baseUrl, unwrap } = require('./utils');

/**
 * Connection: the installation's URL plus an API key.
 *
 * The key is the same `ak_live_…` bearer every `/api/v1` route expects, created
 * on Company → Developers. Nothing about the request differs from a customer
 * calling the API themselves — this app is only a well-behaved client.
 *
 * Full access is asked for because the app spans three areas (contacts,
 * conversations, orders) and a narrower key would fail the connection test in a
 * way that looks like a wrong key rather than a missing scope.
 */
const test = async (z, bundle) => {
  const response = await z.request({ url: `${baseUrl(bundle)}/api/v1/auth/me` });
  const me = unwrap(response) || {};
  const company = me.company || {};
  // Flattened, because the connection label template below reads this object.
  return {
    id: company.id,
    name: company.name,
    website: company.website,
    plan: (me.plan || {}).name,
    scopes: (me.api_key || {}).scopes,
  };
};

module.exports = {
  type: 'custom',
  fields: [
    {
      key: 'appUrl',
      label: 'Account URL',
      type: 'string',
      required: true,
      default: 'https://app.example.com',
      helpText:
        'The web address you sign in to, with no trailing slash — for example `https://app.example.com`. It is shown at the top of **Company → Developers**.',
    },
    {
      key: 'apiKey',
      label: 'API key',
      type: 'password',
      required: true,
      helpText:
        'Create one on **Company → Developers → API keys** with **Full access**. It starts with `ak_live_` and is shown only once, so copy it before closing the dialog.',
    },
  ],
  test,
  connectionLabel: '{{name}}',
};
