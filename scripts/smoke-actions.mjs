// Smoke test for the smart chat-action system against the REAL DB + running dev
// server. Exercises: real seedDefaultQuickActions() against the live schema, the
// widget config endpoint, the chat SSE action event, and the form-submit -> lead
// persistence path. Creates a throwaway company and deletes it at the end.
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { createRequire } from 'module';
import { readFileSync } from 'fs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const Module = require('module');

// Transpile + load the REAL seeding module (DB import is type-only -> neutralised).
const src = readFileSync('src/lib/quick-actions-defaults.ts', 'utf8')
  .replace(/import \{ createSupabaseServiceClient \}[^\n]*\n/, '')
  .replace(/import type \{[^}]*\} from '@\/lib\/quick-actions';\n/, '');
const jsOut = ts.transpileModule(src, { compilerOptions: { module: 'commonjs', target: 'es2019' } }).outputText;
const seedMod = new Module('seed');
seedMod._compile(jsOut, 'seed.cjs');
const { seedDefaultQuickActions } = seedMod.exports;

const APP = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let failures = 0;
const check = (label, cond, extra) => {
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};
const soft = (label, cond, extra) => console.log(`${cond ? '✅' : '⚠️ '} ${label}${extra ? ' — ' + extra : ''}`);

const parseSSE = (raw) =>
  raw
    .split('\n\n')
    .filter((b) => b.trim().startsWith('data:'))
    .map((b) => {
      try { return JSON.parse(b.trim().slice(5).trim()); } catch { return null; }
    })
    .filter(Boolean);

let companyId;
try {
  const { data: company } = await admin.from('companies').insert({ name: 'QA Actions Co' }).select('id').single();
  companyId = company.id;
  const caps = ['lead_capture', 'sales_agent', 'human_agent_takeover', 'product_stock_assistant'];
  const { data: bot } = await admin
    .from('bots')
    .insert({
      company_id: companyId,
      name: 'QA Actions Bot',
      bot_type: 'hybrid_business_assistant',
      ai_enabled: true,
      capability_flags: caps,
      system_prompt:
        'You are a helpful sales assistant. When a visitor wants a quote, a pricing callback, or to be contacted, call show_lead_form to display a form instead of asking for fields one by one. When a visitor asks to see, browse, or show products, call show_product_cards to display them as cards.',
    })
    .select('id, public_bot_id')
    .single();
  const botId = bot.id;
  const publicBotId = bot.public_bot_id;

  // --- 1. Real seeding code against the live schema -------------------------
  await seedDefaultQuickActions(admin, companyId, botId, caps);
  const { data: qa } = await admin
    .from('bot_quick_actions')
    .select('id, action_type, action_config_json')
    .eq('bot_id', botId);
  check('Seeding inserted quick actions', (qa?.length ?? 0) >= 2, `${qa?.length ?? 0} rows`);
  const leadQA = qa?.find((r) => r.action_config_json?.defaultKey === 'lead_form');
  check('lead_form default seeded', !!leadQA);
  check('human_handoff default seeded', !!qa?.find((r) => r.action_config_json?.defaultKey === 'human_handoff'));

  // Idempotency: re-seed must not duplicate.
  await seedDefaultQuickActions(admin, companyId, botId, caps);
  const { data: qa2 } = await admin.from('bot_quick_actions').select('id').eq('bot_id', botId);
  check('Re-seed is idempotent (no duplicates)', qa2?.length === qa?.length, `${qa2?.length} rows`);

  // A product for the product-cards check.
  await admin.from('synced_products').insert({
    company_id: companyId, external_id: 'p1', title: 'Blue Widget',
    description: 'A nice blue widget', price: 19.99, currency: 'USD', sku: 'BW-1', status: 'active',
  });

  // --- 2. Widget config surfaces the seeded actions ------------------------
  const cfgRes = await fetch(
    `${APP}/api/widget/config?publicBotId=${encodeURIComponent(publicBotId)}&context=initial`,
    { headers: { Origin: APP } },
  );
  const cfgJson = await cfgRes.json();
  check('Config endpoint 200', cfgRes.status === 200);
  check(
    'Config exposes seeded lead_form action',
    Array.isArray(cfgJson.quickActions) && cfgJson.quickActions.some((a) => a.actionType === 'lead_form'),
    `${cfgJson.quickActions?.length ?? 0} actions`,
  );

  // --- 3. Chat stream emits a lead_form action event -----------------------
  const chatRes = await fetch(`${APP}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: APP },
    body: JSON.stringify({
      publicBotId,
      visitorId: 'qa-actions-1',
      text: 'Please show me a form so I can leave my contact details and get a price quote.',
    }),
  });
  check('Chat API 200', chatRes.status === 200);
  const events = parseSSE(await chatRes.text());
  const conversationId = events.find((e) => e.type === 'meta')?.conversationId;
  const actionEvt = events.find((e) => e.type === 'action' && e.action === 'lead_form');
  check(
    'Chat emitted lead_form action event',
    !!actionEvt,
    actionEvt ? `actionId=${actionEvt.payload?.actionId}` : 'events: ' + events.map((e) => e.type + (e.action ? '/' + e.action : '')).join(','),
  );
  check('Action payload carries form fields', Array.isArray(actionEvt?.payload?.fields) && actionEvt.payload.fields.length > 0);

  // --- 4. Submit the form -> lead persisted --------------------------------
  const submitActionId = actionEvt?.payload?.actionId || leadQA?.id;
  const subRes = await fetch(`${APP}/api/widget/actions/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: APP },
    body: JSON.stringify({
      publicBotId,
      visitorId: 'qa-actions-1',
      conversationId,
      actionId: submitActionId,
      formValues: { name: 'Test Lead', phone: '+1234567890', email: 'lead@example.com', message: 'Quote please' },
    }),
  });
  const subJson = await subRes.json();
  check('Submit endpoint ok', subRes.status === 200 && subJson.ok === true, subJson.message);
  const { data: leads } = await admin.from('leads').select('id, name, source').eq('company_id', companyId);
  check('Lead row persisted from form submit', leads?.some((l) => l.name === 'Test Lead'), `${leads?.length ?? 0} lead(s)`);

  // --- 5. Product cards (model-dependent -> soft) --------------------------
  const pRes = await fetch(`${APP}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: APP },
    body: JSON.stringify({ publicBotId, visitorId: 'qa-actions-2', text: 'Show me your products as cards.' }),
  });
  const pEvents = parseSSE(await pRes.text());
  const cardsEvt = pEvents.find((e) => e.type === 'action' && e.action === 'product_cards');
  soft('Chat emitted product_cards action', !!cardsEvt, cardsEvt ? `${cardsEvt.payload?.products?.length} card(s)` : 'model did not call show_product_cards this run');
} catch (err) {
  console.error('❌ run error:', err);
  failures++;
} finally {
  if (companyId) await admin.from('companies').delete().eq('id', companyId);
  console.log('🧹 cleaned up');
}

console.log(failures === 0 ? '\n🎉 Smoke test passed' : `\n❌ ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
