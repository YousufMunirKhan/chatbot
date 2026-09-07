// WhatsApp Business suite verification — pure logic, no live Meta credentials
// and no database. Loads the REAL TypeScript modules (transpiled in-process,
// provider imports replaced with recording stubs) so the assertions below are
// against shipped code, not a copy of it.
//
// Covers: STOP/START keyword detection in English + Arabic, the exact JSON of a
// template message, the product / product_list catalog messages, and broadcast
// audience resolution including the opt-out rule.
import { createRequire } from 'module';
import { readFileSync } from 'fs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const Module = require('module');

let failures = 0;
const check = (label, cond, extra) => {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) {
    failures++;
    if (extra !== undefined) console.log('   got:', JSON.stringify(extra));
  }
};
const eq = (label, actual, expected) =>
  check(label, JSON.stringify(actual) === JSON.stringify(expected), actual);

// --- Loader ----------------------------------------------------------------
// Import statements are stripped before transpiling, so the imported bindings
// become free identifiers that the preamble below defines. That lets the pure
// functions run untouched while every network/DB call is a stub we can inspect.
const sent = [];
const PREAMBLE = `
const sendWhatsAppRaw = async (token, phoneNumberId, to, message) => {
  __sent.push({ token, phoneNumberId, to, message });
  return true;
};
const postJson = async () => ({ ok: true, status: 200, body: {} });
const getJson = async () => ({ ok: true, status: 200, body: { data: [] } });
const request = async () => ({ ok: true, status: 200, body: {} });
const logger = { warn() {}, info() {}, error() {} };
const createSupabaseServiceClient = () => { throw new Error('DB not available in this test'); };
`;

function load(path) {
  const src = readFileSync(path, 'utf8').replace(/^import[^;]*?;$/gms, '');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: 'commonjs', target: 'es2020' },
  }).outputText;
  const mod = new Module(path);
  mod._compile(`const __sent = global.__waSent;\n${PREAMBLE}\n${js}`, `${path.replace(/\.ts$/, '')}.cjs`);
  return mod.exports;
}

global.__waSent = sent;

const subs = load('src/lib/channels/subscriptions.ts');
const tpl = load('src/lib/channels/whatsapp-templates.ts');
const cat = load('src/lib/channels/whatsapp-catalog.ts');
const aud = load('src/lib/channels/broadcast-audience.ts');
const guides = load('src/lib/channels/whatsapp-guides.ts');
const account = load('src/lib/channels/whatsapp-account.ts');

try {
  // =========================================================================
  // 1. Opt-in / opt-out keyword detection
  // =========================================================================
  console.log('\n— Opt keywords —');
  check('"STOP" opts out', subs.handleOptKeyword('STOP') === 'opt_out');
  check('"stop " (padded, lowercase) opts out', subs.handleOptKeyword('  stop  ') === 'opt_out');
  check('"Unsubscribe" opts out', subs.handleOptKeyword('Unsubscribe') === 'opt_out');
  check('"CANCEL" opts out', subs.handleOptKeyword('CANCEL') === 'opt_out');
  check('Arabic "ايقاف" opts out', subs.handleOptKeyword('ايقاف') === 'opt_out');
  check('Arabic "إيقاف" (hamza form) normalises to opt out', subs.handleOptKeyword('إيقاف') === 'opt_out');
  check('Arabic "الغاء الاشتراك" opts out, not in', subs.handleOptKeyword('الغاء الاشتراك') === 'opt_out');

  check('"START" opts in', subs.handleOptKeyword('START') === 'opt_in');
  check('"subscribe" opts in', subs.handleOptKeyword('subscribe') === 'opt_in');
  check('Arabic "اشتراك" opts in', subs.handleOptKeyword('اشتراك') === 'opt_in');
  check('Arabic "إشتراك" (hamza form) opts in', subs.handleOptKeyword('إشتراك') === 'opt_in');

  check('A sentence containing "stop" is NOT an opt-out', subs.handleOptKeyword('please stop sending me offers') === null);
  check('Ordinary question is not a keyword', subs.handleOptKeyword('are you open today?') === null);
  check('Empty message is not a keyword', subs.handleOptKeyword('') === null);
  check('Punctuation is ignored ("Stop.")', subs.handleOptKeyword('Stop.') === 'opt_out');

  // =========================================================================
  // 2. Template message construction
  // =========================================================================
  console.log('\n— Template messages —');
  eq(
    'Positional variables build a body component',
    tpl.buildTemplateMessage('order_update', 'en_US', ['Sara', 'ORD-1042']),
    {
      type: 'template',
      template: {
        name: 'order_update',
        language: { code: 'en_US' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'Sara' },
              { type: 'text', text: 'ORD-1042' },
            ],
          },
        ],
      },
    },
  );

  eq('No variables omits the components array entirely', tpl.buildTemplateMessage('hello_world', 'ar'), {
    type: 'template',
    template: { name: 'hello_world', language: { code: 'ar' } },
  });

  const named = tpl.buildTemplateMessage('welcome', 'en_US', { first_name: 'Sara' });
  eq('Named variables carry parameter_name', named.template.components[0].parameters, [
    { type: 'text', parameter_name: 'first_name', text: 'Sara' },
  ]);

  const withHeader = tpl.buildTemplateMessage('promo', 'en_US', ['20%'], {
    headerVariables: ['Summer'],
    buttonUrlVariables: ['sale-2026'],
  });
  eq(
    'Header, body and URL-button components appear in Meta order',
    withHeader.template.components.map((c) => c.type),
    ['header', 'body', 'button'],
  );
  eq('URL button component is indexed as a string', withHeader.template.components[2], {
    type: 'button',
    sub_type: 'url',
    index: '0',
    parameters: [{ type: 'text', text: 'sale-2026' }],
  });

  check('Language defaults to en_US when blank', tpl.buildTemplateMessage('x', '').template.language.code === 'en_US');

  check('Template names are normalised to snake_case', tpl.normalizeTemplateName('Order Update! v2') === 'order_update_v2');
  check('Leading/trailing separators are trimmed', tpl.normalizeTemplateName('  --Hello--  ') === 'hello');
  check('Placeholders are counted, deduplicated', tpl.countPlaceholders('Hi {{1}}, order {{2}} — {{1}}') === 2);

  eq(
    'Definition components are ordered HEADER, BODY, FOOTER, BUTTONS',
    tpl
      .buildTemplateComponents({
        name: 'promo',
        language: 'en_US',
        category: 'MARKETING',
        body: 'Hi {{1}}',
        header: { format: 'TEXT', text: 'Sale' },
        footer: 'Reply STOP to unsubscribe',
        buttons: [
          { type: 'URL', text: 'Shop', url: 'https://example.com' },
          { type: 'QUICK_REPLY', text: 'No thanks' },
        ],
      })
      .map((c) => c.type),
    ['HEADER', 'BODY', 'FOOTER', 'BUTTONS'],
  );

  check('APPROVED maps to approved', tpl.mapMetaStatus('APPROVED') === 'approved');
  check('PAUSED is treated as rejected (undeliverable)', tpl.mapMetaStatus('PAUSED') === 'rejected');
  check('IN_APPEAL is treated as pending', tpl.mapMetaStatus('IN_APPEAL') === 'pending');
  check('Unknown status falls back to draft', tpl.mapMetaStatus(undefined) === 'draft');

  sent.length = 0;
  const templateOk = await tpl.sendWhatsAppTemplate('TOKEN', 'PHONE_ID', '+971500000000', 'order_update', 'en_US', ['Sara']);
  check('sendWhatsAppTemplate reports success', templateOk === true);
  check('sendWhatsAppTemplate posted exactly one message', sent.length === 1, sent.length);
  check('…to the right number on the right phone id', sent[0]?.to === '+971500000000' && sent[0]?.phoneNumberId === 'PHONE_ID');
  check('…as a type:template message', sent[0]?.message?.type === 'template');

  // =========================================================================
  // 3. Catalog messages
  // =========================================================================
  console.log('\n— Catalog messages —');
  eq('Single product message shape', cat.buildProductMessage('CAT1', 'SKU-9', { body: 'In stock now' }), {
    type: 'interactive',
    interactive: {
      type: 'product',
      action: { catalog_id: 'CAT1', product_retailer_id: 'SKU-9' },
      body: { text: 'In stock now' },
    },
  });

  const list = cat.buildProductListMessage(
    'CAT1',
    [
      { title: 'Best sellers', retailerIds: ['A1', 'A2'] },
      { title: 'New in', retailerIds: ['B1'] },
    ],
    { header: 'Our menu', body: 'Tap to order' },
  );
  check('Product list uses interactive type product_list', list.interactive.type === 'product_list');
  check('Product list carries the catalog id', list.interactive.action.catalog_id === 'CAT1');
  eq('Product list sections wrap each retailer id', list.interactive.action.sections, [
    { title: 'Best sellers', product_items: [{ product_retailer_id: 'A1' }, { product_retailer_id: 'A2' }] },
    { title: 'New in', product_items: [{ product_retailer_id: 'B1' }] },
  ]);
  check('Product list header is a text header', list.interactive.header.type === 'text');

  const many = cat.buildProductListMessage('CAT1', [
    { title: 'All', retailerIds: Array.from({ length: 40 }, (_, i) => `P${i}`) },
  ]);
  const total = many.interactive.action.sections.reduce((n, s) => n + s.product_items.length, 0);
  check('Product list clamps to WhatsApp\'s 30-item ceiling', total === 30, total);

  const emptySections = cat.buildProductListMessage('CAT1', [{ title: 'Unmapped', retailerIds: [] }]);
  eq('Sections with no mapped retailer ids are dropped', emptySections.interactive.action.sections, []);

  sent.length = 0;
  check('Product send is refused without a catalog id', (await cat.sendWhatsAppProduct('T', 'P', '+1', '', 'SKU')) === false);
  check('Product list send is refused when nothing is mapped', (await cat.sendWhatsAppProductList('T', 'P', '+1', 'CAT1', [{ title: 'x', retailerIds: [] }])) === false);
  check('…and neither attempt hit the API', sent.length === 0, sent.length);
  check('A mapped product does send', (await cat.sendWhatsAppProduct('T', 'P', '+971500000000', 'CAT1', 'SKU-9')) === true);
  check('…as an interactive product message', sent[0]?.message?.interactive?.type === 'product');

  // =========================================================================
  // 4. Broadcast audience resolution
  // =========================================================================
  console.log('\n— Audience resolution —');
  const contacts = [
    { identifier: '+1000000001', tags: ['VIP'], status: 'qualified' },
    { identifier: '+1000000002', tags: [], status: 'new' },
    { identifier: '+1000000003', tags: ['vip', 'ramadan'], status: 'converted' },
    { identifier: '+1000000004', tags: [], status: 'qualified' },
    { identifier: '+1000000002', tags: [], status: 'new' }, // duplicate lead row
  ];
  const optedOut = new Set(['+1000000004']);
  const optedIn = new Set(['+1000000001', '+1000000004']);
  const ctx = { optedIn, optedOut };

  eq(
    'all_leads takes everyone except the opted-out contact, deduplicated',
    aud.resolveAudience(contacts, { audience: 'all_leads', filter: {} }, ctx),
    ['+1000000001', '+1000000002', '+1000000003'],
  );

  eq(
    'opted_in takes only explicit opt-ins — and still drops the opt-out',
    aud.resolveAudience(contacts, { audience: 'opted_in', filter: {} }, ctx),
    ['+1000000001'],
  );

  eq(
    'tag targeting is case-insensitive',
    aud.resolveAudience(contacts, { audience: 'tag', filter: { tag: 'vip' } }, ctx),
    ['+1000000001', '+1000000003'],
  );

  eq(
    'tag targeting with no tag configured sends to nobody',
    aud.resolveAudience(contacts, { audience: 'tag', filter: {} }, ctx),
    [],
  );

  eq(
    'segment targeting filters on lead status',
    aud.resolveAudience(contacts, { audience: 'segment', filter: { status: 'qualified' } }, ctx),
    ['+1000000001'],
  );

  eq(
    'custom lists are honoured, but an opt-out still wins',
    aud.resolveAudience(
      contacts,
      { audience: 'custom', filter: { contacts: ['+1000000004', '+1000000003', '+1999999999'] } },
      ctx,
    ),
    ['+1000000003', '+1999999999'],
  );

  eq(
    'An unknown audience value degrades to all_leads rather than sending nothing',
    aud.resolveAudience(contacts, { audience: 'nonsense', filter: {} }, ctx),
    ['+1000000001', '+1000000002', '+1000000003'],
  );

  eq('Missing filter object is tolerated', aud.resolveAudience(contacts, { audience: 'all_leads' }, ctx).length, 3);

  // =========================================================================
  // 5. Guides + account helpers
  // =========================================================================
  console.log('\n— Guides & account —');
  check('Both checklists are exported', guides.WHATSAPP_GUIDES.length === 2);
  const stepKeys = guides.WHATSAPP_GUIDES.flatMap((g) => g.steps.map((s) => `${g.key}:${s.key}`));
  check('Every step key is unique (progress rows key off it)', new Set(stepKeys).size === stepKeys.length);
  check('Every step has a title and detail', guides.WHATSAPP_GUIDES.every((g) => g.steps.every((s) => s.title && s.detail)));
  check('getGuide finds the blue tick guide', guides.getGuide('blue_tick')?.key === 'blue_tick');
  check('getGuide returns null for an unknown key', guides.getGuide('nope') === null);

  check('TIER_1K reads as a sentence', account.describeMessagingLimit('TIER_1K') === '1,000 customers / 24h');
  check('Unknown tier does not render as "undefined"', account.describeMessagingLimit(null) === 'Not reported yet');
} catch (err) {
  console.error('❌ Test run error:', err instanceof Error ? err.stack : err);
  failures++;
}

console.log(failures === 0 ? '\n🎉 WhatsApp suite logic verified.' : `\n❌ ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
