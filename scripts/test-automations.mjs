// Offline unit tests for the e-commerce automation engine (Module: store
// automations). No network, no database, no dev server: the REAL TypeScript
// sources are transpiled and loaded, so these assertions break when the shipped
// logic changes rather than when a copy of it drifts.
//
// Covers: template rendering + placeholders, condition evaluation, Shopify and
// WooCommerce webhook signature verification, topic -> event mapping, and the
// abandoned-cart threshold rules.
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { createHmac } from 'crypto';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const Module = require('module');

/** Transpile one TS file and load it as CommonJS, resolving `./` siblings. */
function load(path, deps = {}) {
  const src = readFileSync(path, 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: 'commonjs', target: 'es2020' },
  }).outputText;
  const mod = new Module(path);
  mod.require = (request) => {
    if (deps[request]) return deps[request];
    return require(request);
  };
  mod._compile(js, `${path.replace(/\.ts$/, '')}.cjs`);
  return mod.exports;
}

const templates = load('src/lib/commerce/automation-templates.ts');
const signatures = load('src/lib/commerce/store-signatures.ts', {
  './automation-templates': templates,
});
const starters = load('src/lib/commerce/starter-rules.ts', {
  './automation-templates': templates,
});

const {
  AUTOMATION_EVENTS,
  TEMPLATE_PLACEHOLDERS,
  renderTemplate,
  templateVars,
  evaluateConditions,
  mapStoreTopic,
  isCheckoutTopic,
  deriveOrderEvent,
  abandonThresholdMinutes,
  isCartAbandoned,
  buildRecoveryLink,
  contactForChannel,
  DEFAULT_ABANDON_MINUTES,
} = templates;
const { storeSignature, verifyStoreSignature, STORE_SIGNATURE_HEADERS } = signatures;
const { STARTER_RULES, getStarterRule } = starters;

let failures = 0;
const check = (label, cond, extra) => {
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

const ORDER = {
  id: '1234',
  type: 'order',
  orderNumber: '#1001',
  customerName: 'Ada Lovelace',
  customerEmail: 'ada@example.com',
  customerPhone: '+15551234567',
  total: 129.5,
  currency: 'USD',
  status: 'paid',
  trackingNumber: 'TRK1',
  trackingUrl: 'https://track.example.com/TRK1',
  items: [
    { title: 'Blue Widget', quantity: 2, price: 49.75 },
    { title: 'Red Widget', quantity: 1, price: 30 },
  ],
  updatedAt: '2026-01-01T00:00:00.000Z',
};

// --- 1. Template rendering --------------------------------------------------
console.log('\n— Template rendering —');
{
  const out = renderTemplate(
    'Hi {{customer_name}}, order {{order_number}} ({{total}}) is on its way: {{tracking_url}}',
    ORDER,
  );
  check(
    'All placeholders substituted',
    out === 'Hi Ada Lovelace, order #1001 (129.50 USD) is on its way: https://track.example.com/TRK1',
    out,
  );
  check('No raw {{ }} tokens survive', !out.includes('{{'));

  const items = renderTemplate('You left {{items}} behind', ORDER);
  check('Items list renders with quantities', items === 'You left 2x Blue Widget, Red Widget behind', items);

  check(
    'Whitespace inside braces is tolerated',
    renderTemplate('{{ order_number }}', ORDER) === '#1001',
  );
  check(
    'Unknown placeholder collapses to nothing (never leaked to a customer)',
    renderTemplate('A{{not_a_field}}B', ORDER) === 'AB',
    renderTemplate('A{{not_a_field}}B', ORDER),
  );
  check(
    'Missing value renders empty rather than "null"',
    renderTemplate('Track: {{tracking_url}}', { id: 'c1', type: 'cart' }) === 'Track:',
    JSON.stringify(renderTemplate('Track: {{tracking_url}}', { id: 'c1', type: 'cart' })),
  );

  const vars = templateVars(ORDER);
  const missing = TEMPLATE_PLACEHOLDERS.filter((p) => !(p in vars));
  check('Every advertised placeholder has a value slot', missing.length === 0, missing.join(','));

  const cart = {
    id: 'cart-1',
    type: 'cart',
    customerName: 'Bo',
    items: [{ title: 'Hat', quantity: 1 }],
    recoveryUrl: 'https://shop.example.com/checkout/abc',
  };
  check(
    'Recovery URL placeholder works for carts',
    renderTemplate('Finish here: {{recovery_url}}', cart) === 'Finish here: https://shop.example.com/checkout/abc',
  );

  // Every shipped starter must render into something sendable.
  for (const starter of STARTER_RULES) {
    const entity = starter.triggerEvent === 'cart_abandoned' ? cart : ORDER;
    const body = renderTemplate(starter.messageTemplate, entity);
    check(`Starter "${starter.name}" renders a non-empty message`, body.length > 10 && !body.includes('{{'));
  }
  check('getStarterRule finds a known key', getStarterRule('order_confirmation')?.triggerEvent === 'order_paid');
  check('getStarterRule rejects an unknown key', getStarterRule('nope') === null);
  check(
    'Every starter targets a real trigger event',
    STARTER_RULES.every((s) => AUTOMATION_EVENTS.includes(s.triggerEvent)),
  );
}

// --- 2. Condition evaluation ------------------------------------------------
console.log('\n— Condition evaluation —');
{
  check('Empty conditions always match', evaluateConditions({}, ORDER) === true);
  check('Null conditions always match', evaluateConditions(null, ORDER) === true);
  check('Malformed conditions fail open, not closed', evaluateConditions('nonsense', ORDER) === true);

  check('minTotal below order total matches', evaluateConditions({ minTotal: 100 }, ORDER) === true);
  check('minTotal above order total blocks', evaluateConditions({ minTotal: 500 }, ORDER) === false);
  check('maxTotal above order total matches', evaluateConditions({ maxTotal: 200 }, ORDER) === true);
  check('maxTotal below order total blocks', evaluateConditions({ maxTotal: 20 }, ORDER) === false);

  check('currency match is case-insensitive', evaluateConditions({ currency: 'usd' }, ORDER) === true);
  check('currency mismatch blocks', evaluateConditions({ currency: 'GBP' }, ORDER) === false);
  check('currency list matches any member', evaluateConditions({ currency: ['GBP', 'USD'] }, ORDER) === true);

  check('status match', evaluateConditions({ status: 'paid' }, ORDER) === true);
  check('status mismatch blocks', evaluateConditions({ status: 'refunded' }, ORDER) === false);

  check('requirePhone passes when a phone exists', evaluateConditions({ requirePhone: true }, ORDER) === true);
  check(
    'requireEmail blocks a contactless entity',
    evaluateConditions({ requireEmail: true }, { id: 'x', type: 'order' }) === false,
  );

  check(
    'all[] clause: gt passes',
    evaluateConditions({ all: [{ field: 'total', op: 'gt', value: 100 }] }, ORDER) === true,
  );
  check(
    'all[] clause: gt fails',
    evaluateConditions({ all: [{ field: 'total', op: 'gt', value: 1000 }] }, ORDER) === false,
  );
  check(
    'all[] clause: every clause must hold',
    evaluateConditions(
      { all: [{ field: 'currency', value: 'USD' }, { field: 'status', value: 'refunded' }] },
      ORDER,
    ) === false,
  );
  check(
    'all[] clause: contains',
    evaluateConditions({ all: [{ field: 'customer_email', op: 'contains', value: 'example.com' }] }, ORDER) === true,
  );
  check(
    'Combined conditions AND together',
    evaluateConditions({ minTotal: 100, currency: 'USD', status: 'paid' }, ORDER) === true,
  );

  check('contactForChannel(whatsapp) uses the phone', contactForChannel('whatsapp', ORDER) === ORDER.customerPhone);
  check('contactForChannel(email) uses the email', contactForChannel('email', ORDER) === ORDER.customerEmail);
  check(
    'contactForChannel returns null when unreachable',
    contactForChannel('email', { id: 'x', type: 'order', customerEmail: '  ' }) === null,
  );
}

// --- 3. Webhook signature verification --------------------------------------
console.log('\n— Webhook signatures —');
{
  const body = JSON.stringify({ id: 999, total_price: '10.00' });
  const shopifySecret = 'shpss_test_secret';
  const wooSecret = 'wc_test_secret';

  const shopifySig = createHmac('sha256', shopifySecret).update(body, 'utf8').digest('base64');
  check('Our digest matches an independently computed HMAC', storeSignature(body, shopifySecret) === shopifySig);
  check('Shopify: valid signature accepted', verifyStoreSignature(body, shopifySig, shopifySecret) === true);
  check(
    'Shopify: signature from the wrong secret rejected',
    verifyStoreSignature(body, createHmac('sha256', 'other').update(body).digest('base64'), shopifySecret) === false,
  );
  check(
    'Shopify: tampered body rejected',
    verifyStoreSignature(body + ' ', shopifySig, shopifySecret) === false,
  );

  const wooSig = createHmac('sha256', wooSecret).update(body, 'utf8').digest('base64');
  check('Woo: valid signature accepted', verifyStoreSignature(body, wooSig, wooSecret) === true);
  check('Woo: Shopify signature does not validate', verifyStoreSignature(body, shopifySig, wooSecret) === false);

  check('Missing signature rejected', verifyStoreSignature(body, null, shopifySecret) === false);
  check('Missing secret rejected (never trusts an unsigned body)', verifyStoreSignature(body, shopifySig, null) === false);
  check('Empty signature rejected', verifyStoreSignature(body, '', shopifySecret) === false);
  check(
    'Length mismatch rejected without throwing',
    verifyStoreSignature(body, 'short', shopifySecret) === false,
  );
  check('Surrounding whitespace on the header is tolerated', verifyStoreSignature(body, ` ${shopifySig} `, shopifySecret) === true);

  check('Shopify header name', STORE_SIGNATURE_HEADERS.shopify === 'x-shopify-hmac-sha256');
  check('WooCommerce header name', STORE_SIGNATURE_HEADERS.woocommerce === 'x-wc-webhook-signature');
}

// --- 4. Topic -> event mapping ----------------------------------------------
console.log('\n— Topic mapping —');
{
  const cases = [
    ['shopify', 'orders/create', 'order_created'],
    ['shopify', 'orders/paid', 'order_paid'],
    ['shopify', 'orders/cancelled', 'order_cancelled'],
    ['shopify', 'orders/fulfilled', 'order_shipped'],
    ['shopify', 'refunds/create', 'order_refunded'],
    ['shopify', 'checkouts/create', 'cart_abandoned'],
    ['shopify', 'customers/create', 'customer_created'],
    ['woocommerce', 'order.created', 'order_created'],
    ['woocommerce', 'customer.created', 'customer_created'],
  ];
  for (const [provider, topic, expected] of cases) {
    const got = mapStoreTopic(provider, topic);
    check(`${provider} ${topic} -> ${expected}`, got === expected, String(got));
  }

  check('Topic casing is normalised', mapStoreTopic('shopify', 'Orders/Create') === 'order_created');
  check('Dot and slash separators both work', mapStoreTopic('shopify', 'orders.paid') === 'order_paid');
  check('orders/updated has no fixed event (derived from status)', mapStoreTopic('shopify', 'orders/updated') === null);
  check('Unknown topic maps to null', mapStoreTopic('shopify', 'themes/publish') === null);

  check('Shopify checkout topics are recognised as carts', isCheckoutTopic('shopify', 'checkouts/create') === true);
  check('Order topics are not checkouts', isCheckoutTopic('shopify', 'orders/create') === false);
  check('Woo has no checkout topic', isCheckoutTopic('woocommerce', 'checkouts/create') === false);

  check('derive: cancelled', deriveOrderEvent('cancelled', null) === 'order_cancelled');
  check('derive: refunded', deriveOrderEvent('refunded', null) === 'order_refunded');
  check('derive: fulfilled -> shipped', deriveOrderEvent('paid', 'fulfilled') === 'order_shipped');
  check('derive: delivered', deriveOrderEvent('paid', 'delivered') === 'order_delivered');
  check('derive: woo completed -> shipped', deriveOrderEvent('completed', 'completed') === 'order_shipped');
  check('derive: paid', deriveOrderEvent('paid', null) === 'order_paid');
  check('derive: cancellation beats fulfilment', deriveOrderEvent('cancelled', 'fulfilled') === 'order_cancelled');
  check('derive: pending yields nothing', deriveOrderEvent('pending', null) === null);
  check('derive: no status yields nothing', deriveOrderEvent(null, null) === null);
}

// --- 5. Abandoned-cart threshold --------------------------------------------
console.log('\n— Abandoned carts —');
{
  const now = new Date('2026-01-01T12:00:00.000Z');
  const minutesAgo = (m) => new Date(now.getTime() - m * 60_000).toISOString();

  check('Default threshold is 60 minutes', DEFAULT_ABANDON_MINUTES === 60);
  check('No conditions -> default threshold', abandonThresholdMinutes({}) === 60);
  check('Rule threshold is honoured', abandonThresholdMinutes({ abandonAfterMinutes: 15 }) === 15);
  check('Zero/negative threshold falls back to the default', abandonThresholdMinutes({ abandonAfterMinutes: 0 }) === 60);
  check('Junk threshold falls back to the default', abandonThresholdMinutes({ abandonAfterMinutes: 'soon' }) === 60);
  check('Explicit fallback is respected', abandonThresholdMinutes(null, 30) === 30);

  check('59 minutes quiet is NOT abandoned at a 60 minute threshold', isCartAbandoned(minutesAgo(59), now, 60) === false);
  check('Exactly 60 minutes quiet IS abandoned', isCartAbandoned(minutesAgo(60), now, 60) === true);
  check('90 minutes quiet is abandoned', isCartAbandoned(minutesAgo(90), now, 60) === true);
  check('A shorter rule threshold fires sooner', isCartAbandoned(minutesAgo(20), now, 15) === true);
  check('Same threshold, fresher cart does not fire', isCartAbandoned(minutesAgo(5), now, 15) === false);
  check('A never-touched cart is not abandoned', isCartAbandoned(null, now, 60) === false);
  check('An unparseable timestamp is not abandoned', isCartAbandoned('not-a-date', now, 60) === false);
  check('Date objects are accepted', isCartAbandoned(new Date(now.getTime() - 3_600_000), now, 60) === true);
  check('Epoch millis are accepted for "now"', isCartAbandoned(minutesAgo(61), now.getTime(), 60) === true);

  check(
    'Recovery link prefers the store checkout URL',
    buildRecoveryLink({
      appUrl: 'https://app.example.com',
      cartId: 'c1',
      checkoutUrl: 'https://shop.example.com/checkout/abc',
    }) === 'https://shop.example.com/checkout/abc',
  );
  check(
    'Recovery link falls back to the app with a cart marker',
    buildRecoveryLink({ appUrl: 'https://app.example.com/', cartId: 'c 1' }) ===
      'https://app.example.com/?recover_cart=c%201',
    buildRecoveryLink({ appUrl: 'https://app.example.com/', cartId: 'c 1' }),
  );
  check(
    'A non-URL "checkout url" is ignored rather than sent',
    buildRecoveryLink({ appUrl: 'https://app.example.com', cartId: 'c1', checkoutUrl: 'javascript:alert(1)' }) ===
      'https://app.example.com/?recover_cart=c1',
  );
}

console.log(failures === 0 ? '\n🎉 Automation tests passed' : `\n❌ ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
