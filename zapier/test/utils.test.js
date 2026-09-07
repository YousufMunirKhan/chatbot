'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  baseUrl,
  unwrap,
  performHook,
  subscribeHook,
  unsubscribeHook,
  listSamples,
} = require('../utils');

/**
 * These cover the four places the app can silently do the wrong thing: build a
 * URL with a double slash, hand a Zap the envelope instead of the record, POST
 * a subscribe body the API rejects, or leave a subscription behind when a Zap
 * is switched off. None of them need the platform or the network.
 *
 *   node --test zapier/test/
 */

const bundleFor = (extra) =>
  Object.assign({ authData: { appUrl: 'https://app.example.com', apiKey: 'ak_live_x' } }, extra);

/** A `z` with just enough of the platform to record what was requested. */
const fakeZ = (response) => {
  const calls = [];
  return {
    calls,
    z: {
      request: async (options) => {
        calls.push(options);
        return response;
      },
    },
  };
};

test('baseUrl trims trailing slashes so paths never double up', () => {
  assert.equal(baseUrl(bundleFor()), 'https://app.example.com');
  assert.equal(
    baseUrl({ authData: { appUrl: 'https://app.example.com///' } }),
    'https://app.example.com',
  );
  assert.equal(baseUrl({ authData: {} }), '');
});

test('unwrap takes the envelope apart, and leaves a bare body alone', () => {
  assert.deepEqual(unwrap({ data: { data: { id: 'a' } } }), { id: 'a' });
  assert.deepEqual(unwrap({ data: { data: [1, 2] } }), [1, 2]);
  assert.deepEqual(unwrap({ data: { id: 'b' } }), { id: 'b' });
  // `data: null` is a real answer, not a missing key: it must survive as null.
  assert.equal(unwrap({ data: { data: null } }), null);
});

test('a delivered hook gives the Zap the record, not the envelope', () => {
  const perform = performHook();
  const delivered = {
    event: 'enquiry.created',
    created_at: '2026-01-01T09:00:00.000Z',
    company_id: 'c1',
    title: 'New enquiry',
    data: { id: 'lead-1', email: 'person@example.com' },
  };
  const result = perform(null, bundleFor({ cleanedRequest: delivered }));
  assert.deepEqual(result, [{ id: 'lead-1', email: 'person@example.com' }]);
  // Zapier deduplicates on `id`; burying it inside the envelope would break that.
  assert.equal(result[0].id, 'lead-1');
});

test('a body with no envelope is still passed through rather than dropped', () => {
  const perform = performHook();
  assert.deepEqual(perform(null, bundleFor({ cleanedRequest: { id: 'x' } })), [{ id: 'x' }]);
  assert.deepEqual(perform(null, bundleFor({})), [{}]);
});

test('subscribe posts the event and the target URL Zapier gave us', async () => {
  const { z, calls } = fakeZ({ data: { data: { id: 'sub-1', event: 'order.placed' } } });
  const result = await subscribeHook('order.placed', 'New Order')(
    z,
    bundleFor({ targetUrl: 'https://hooks.zapier.com/hooks/standard/1/abc/' }),
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://app.example.com/api/v1/hooks');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].body.event, 'order.placed');
  assert.equal(calls[0].body.target_url, 'https://hooks.zapier.com/hooks/standard/1/abc/');
  assert.equal(calls[0].body.client, 'zapier');
  // The label is what an owner sees on Company → Webhooks next to the endpoint.
  assert.equal(calls[0].body.label, 'Zapier — New Order');
  // Zapier stores this as `bundle.subscribeData`, so the id has to come back.
  assert.equal(result.id, 'sub-1');
});

test('unsubscribe deletes by the id subscribe returned', async () => {
  const { z, calls } = fakeZ({ data: { data: { id: 'sub-1', deleted: true } } });
  await unsubscribeHook()(z, bundleFor({ subscribeData: { id: 'sub-1' } }));
  assert.equal(calls[0].url, 'https://app.example.com/api/v1/hooks/sub-1');
  assert.equal(calls[0].method, 'DELETE');
});

test('unsubscribe with nothing to unsubscribe does not call the API', async () => {
  const { z, calls } = fakeZ({ data: {} });
  const result = await unsubscribeHook()(z, bundleFor({ subscribeData: null }));
  assert.equal(calls.length, 0);
  assert.deepEqual(result, {});
});

test('performList asks for the event it belongs to and always returns an array', async () => {
  const { z, calls } = fakeZ({ data: { data: [{ id: 'lead-1' }] } });
  const records = await listSamples('enquiry.created')(z, bundleFor());
  assert.equal(calls[0].url, 'https://app.example.com/api/v1/hooks/samples');
  assert.deepEqual(calls[0].params, { event: 'enquiry.created', limit: 3 });
  assert.deepEqual(records, [{ id: 'lead-1' }]);

  const empty = fakeZ({ data: { data: null } });
  assert.deepEqual(await listSamples('enquiry.created')(empty.z, bundleFor()), []);
});
