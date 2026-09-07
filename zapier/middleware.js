'use strict';

/**
 * Request and response middleware.
 *
 * Two jobs: put the bearer token on every request so no trigger or action has
 * to remember, and turn the API's error envelope into a message a person can
 * act on. Zapier shows whatever is thrown here directly in the Zap history, so
 * "This API key is missing the `orders:read` scope." is worth a great deal more
 * than "Got 403 calling POST /api/v1/hooks".
 */

const addBearerToken = (request, z, bundle) => {
  if (bundle.authData && bundle.authData.apiKey) {
    request.headers = request.headers || {};
    request.headers.Authorization = `Bearer ${bundle.authData.apiKey}`;
  }
  return request;
};

/** `{ error: { code, message } }` → the message, with the status kept. */
const messageFor = (response) => {
  const body = response.data;
  if (body && body.error && body.error.message) return body.error.message;
  if (typeof body === 'string' && body.trim()) return body.slice(0, 300);
  return `Request failed with status ${response.status}.`;
};

const handleApiErrors = (response, z) => {
  if (response.status < 400) return response;

  const message = messageFor(response);

  // 401 means the key is wrong, revoked or expired: tell Zapier the connection
  // itself needs attention so the customer is prompted to reconnect rather than
  // left with a Zap that fails silently every time it runs.
  if (response.status === 401) {
    throw new z.errors.ExpiredAuthError(
      `${message} Reconnect this account with a current API key.`,
    );
  }

  // 402 is this platform's "your plan does not include that" answer. It is not
  // a transient failure and retrying will never help, so it is worth its own
  // sentence.
  if (response.status === 402) {
    throw new z.errors.Error(message, 'PlanLimit', response.status);
  }

  if (response.status === 429) {
    throw new z.errors.ThrottledError(message, Number(response.getHeader('retry-after') || 60));
  }

  throw new z.errors.Error(message, 'ApiError', response.status);
};

module.exports = { addBearerToken, handleApiErrors };
