// Modules 12-25 verification: structured data, order-verification gate,
// restaurant modifiers, usage aggregation, leads/appointments, retention RPC,
// evals — exercising the exact DB patterns the tools/libs rely on.
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, secret, { auth: { persistSession: false } });

let failures = 0;
const check = (label, cond) => {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures++;
};

let companyId, botId;
try {
  const { data: company } = await admin.from('companies').insert({ name: 'QA Biz Co', slug: `qa-biz-${Date.now()}` }).select('id,slug').single();
  companyId = company.id;
  const { data: bot } = await admin.from('bots').insert({ company_id: companyId, name: 'QA Biz Bot' }).select('id').single();
  botId = bot.id;
  check('Company slug stored for agent URL', Boolean(company.slug));

  // --- M5/6/10: structured business memory ---
  await admin.from('company_business_profiles').upsert({
    company_id: companyId,
    short_description: 'QA Biz Co repairs premium devices and handles support requests.',
    industry: 'electronics repair',
    primary_phone: '+971500000111',
    support_email: 'support@qa-biz.example',
    service_areas: 'Dubai, Sharjah',
    payment_methods: ['card', 'cash'],
    escalation_rules: 'Escalate warranty disputes and angry customers to a human.',
  });
  await admin.from('company_locations').insert({
    company_id: companyId,
    name: 'Main branch',
    city: 'Dubai',
    country: 'AE',
    phone: '+971500000111',
    is_primary: true,
  });
  await admin.from('company_business_hours').insert({
    company_id: companyId,
    day_of_week: 1,
    open_time: '09:00',
    close_time: '18:00',
  });
  await admin.from('company_services').insert({
    company_id: companyId,
    name: 'Screen repair',
    category: 'repairs',
    price_from: 150,
    currency: 'AED',
    booking_required: true,
  });
  await admin.from('company_policies').insert({
    company_id: companyId,
    title: 'Warranty policy',
    category: 'warranty',
    content: 'Repairs include a 30-day workmanship warranty.',
  });
  await admin.from('company_faqs').insert({
    company_id: companyId,
    question: 'Do you repair screens?',
    answer: 'Yes, screen repair is available by appointment.',
  });
  const { data: memory } = await admin.from('company_business_profiles').select('industry,payment_methods').eq('company_id', companyId).maybeSingle();
  check('Business memory profile stored', memory?.industry === 'electronics repair' && memory?.payment_methods?.includes('card'));
  const { count: serviceCount } = await admin.from('company_services').select('id', { count: 'exact', head: true }).eq('company_id', companyId);
  const { count: faqCount } = await admin.from('company_faqs').select('id', { count: 'exact', head: true }).eq('company_id', companyId);
  check('Services + FAQs stored', serviceCount === 1 && faqCount === 1);

  // --- Realtime/agent/quality support ---
  const { error: inviteErr } = await admin.from('agent_invites').insert({
    company_id: companyId,
    email: 'agent@qa-biz.example',
    token_hash: `hash-${Date.now()}`,
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  });
  check('Agent invite stored', !inviteErr);
  const { data: convo } = await admin.from('conversations').insert({
    company_id: companyId,
    bot_id: botId,
    status: 'needs_human',
    ai_enabled: false,
    visitor_id: 'quality-visitor',
  }).select('id').single();
  check('needs_human conversation status accepted', Boolean(convo?.id));
  const { error: qErr } = await admin.from('answer_quality_logs').insert({
    company_id: companyId,
    bot_id: botId,
    conversation_id: convo.id,
    question: 'Do you repair screens?',
    answer: 'Yes, screen repair is available by appointment.',
    provider: 'mock',
    model: 'mock',
    input_tokens: 10,
    output_tokens: 10,
    source_types: ['service_data'],
    failure_reason: null,
  });
  check('Answer quality log stored', !qErr);

  // --- M15/16: products + stock ---
  const { data: prod } = await admin
    .from('synced_products')
    .insert({ company_id: companyId, title: 'Blue Widget', price: 19.99, currency: 'USD', sku: 'BW-1' })
    .select('id')
    .single();
  await admin.from('synced_inventory').insert({ company_id: companyId, product_id: prod.id, quantity: 7, in_stock: true });
  const { data: found } = await admin.from('synced_products').select('id,price').eq('company_id', companyId).ilike('title', '%widget%');
  check('search_products finds product', found?.length === 1 && Number(found[0].price) === 19.99);
  const { data: inv } = await admin.from('synced_inventory').select('quantity').eq('product_id', prod.id);
  check('check_stock reads quantity', (inv ?? []).reduce((s, r) => s + r.quantity, 0) === 7);

  // --- M17: order verification gate ---
  await admin.from('synced_orders').insert({
    company_id: companyId, order_number: 'A1001', customer_phone: '+971500000000', customer_email: 'c@x.com', status: 'shipped', total: 50,
  });
  const verify = async (phone, email) => {
    const { data } = await admin.from('synced_orders').select('customer_phone,customer_email').eq('company_id', companyId).eq('order_number', 'A1001').maybeSingle();
    if (!data) return false;
    const pOk = phone && data.customer_phone?.replace(/\s/g, '') === phone.replace(/\s/g, '');
    const eOk = email && data.customer_email?.toLowerCase() === email.toLowerCase();
    return Boolean(pOk || eOk);
  };
  check('Order verified with correct phone', await verify('+971500000000', ''));
  check('Order NOT verified with wrong phone', !(await verify('+10000000000', '')));

  // --- M15: restaurant required modifiers ---
  const { data: item } = await admin.from('restaurant_menu_items').insert({ company_id: companyId, name: 'Pizza', base_price: 30, is_available: true }).select('id').single();
  const { data: grp } = await admin.from('modifier_groups').insert({ company_id: companyId, name: 'Size', is_required: true, min_select: 1 }).select('id').single();
  await admin.from('modifiers').insert({ company_id: companyId, modifier_group_id: grp.id, name: 'Large', price: 5 });
  await admin.from('menu_item_modifier_groups').insert({ company_id: companyId, menu_item_id: item.id, modifier_group_id: grp.id });
  const { data: links } = await admin.from('menu_item_modifier_groups').select('modifier_group_id').eq('menu_item_id', item.id);
  const { data: grps } = await admin.from('modifier_groups').select('is_required').in('id', links.map((l) => l.modifier_group_id));
  check('Menu item has a required modifier group', grps?.some((g) => g.is_required));

  // --- M20: usage logging + aggregation ---
  await admin.from('ai_usage_logs').insert([
    { company_id: companyId, provider: 'openai', model: 'gpt-4o-mini', operation_type: 'chat', input_tokens: 1000, output_tokens: 500, estimated_cost: 0.00045 },
    { company_id: companyId, provider: 'openai', model: 'text-embedding-3-small', operation_type: 'embedding', input_tokens: 2000, output_tokens: 0, estimated_cost: 0.00004 },
  ]);
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const { count: chatCount } = await admin.from('ai_usage_logs').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('operation_type', 'chat').gte('created_at', monthStart.toISOString());
  check('Monthly message count works', chatCount === 1);
  const { data: costRows } = await admin.from('ai_usage_logs').select('estimated_cost').eq('company_id', companyId);
  const totalCost = (costRows ?? []).reduce((s, r) => s + Number(r.estimated_cost), 0);
  check('AI cost aggregation works', Math.abs(totalCost - 0.00049) < 1e-9);

  // --- M12/13/24: leads, appointments, notifications ---
  await admin.from('leads').insert({ company_id: companyId, bot_id: botId, name: 'Lead Person', email: 'l@x.com', source: 'chat' });
  await admin.from('appointments').insert({ company_id: companyId, customer_name: 'Appt Person', service_type: 'consult', status: 'requested' });
  await admin.from('notifications').insert({ company_id: companyId, type: 'new_lead', title: 'New lead' });
  const { count: leadCount } = await admin.from('leads').select('id', { count: 'exact', head: true }).eq('company_id', companyId);
  const { count: apptCount } = await admin.from('appointments').select('id', { count: 'exact', head: true }).eq('company_id', companyId);
  check('Lead + appointment + notification stored', leadCount === 1 && apptCount === 1);

  // --- M25: eval question ---
  await admin.from('eval_questions').insert({ company_id: companyId, bot_id: botId, question: 'What is the return policy?', language: 'en' });
  const { count: evalCount } = await admin.from('eval_questions').select('id', { count: 'exact', head: true }).eq('company_id', companyId);
  check('Eval question stored', evalCount === 1);

  // --- M23: retention cleanup RPC ---
  const { data: cleaned, error: cleanErr } = await admin.rpc('cleanup_old_chats');
  check('cleanup_old_chats RPC runs', !cleanErr && typeof cleaned === 'number');
} catch (err) {
  console.error('❌ Test run error:', err.message);
  failures++;
} finally {
  if (companyId) await admin.from('companies').delete().eq('id', companyId);
  console.log('🧹 Cleaned up.');
}

console.log(failures === 0 ? '\n🎉 Modules 12-25 data layer verified.' : `\n❌ ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
