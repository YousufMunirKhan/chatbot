// ===========================================================================
// Demo seeder — "SWITCH&SAVE Business Services Ltd" (https://switch-and-save.uk)
// Creates one fully-populated company so you can test the chat assistant locally:
//   company + admin login + subscription + business profile + location + hours +
//   services + policies + FAQs + knowledge docs (RAG) + products + a sample
//   order + a bot + sample eval questions.
//
// Idempotent: re-running wipes the previous demo company (by slug) and rebuilds.
//
// Usage:
//   node scripts/seed-switch-and-save.mjs [adminEmail] [adminPassword]
//   (defaults: demo@switch-and-save.uk / Demo12345!)
// ===========================================================================
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !secret) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
const adminEmail = process.argv[2] || 'demo@switch-and-save.uk';
const adminPassword = process.argv[3] || 'Demo12345!';

const SLUG = 'switch-and-save';
const PUBLIC_BOT_ID = 'switchsavedemo';
const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

// ---- helpers --------------------------------------------------------------
const EMBEDDING_DIM = 1536;
/** Deterministic mock embedding — matches src/lib/ai/providers/mock.ts so
 *  vector search is consistent in keyless local (mock) mode. */
function mockEmbed(text) {
  const v = new Array(EMBEDDING_DIM).fill(0);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    v[(code * 31 + i) % EMBEDDING_DIM] += 1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}
/** Mirrors src/lib/ai/ingest.ts chunkText (size 900, overlap 150). */
function chunkText(text, size = 900, overlap = 150) {
  const clean = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
  if (!clean) return [];
  const chunks = [];
  let i = 0;
  while (i < clean.length) {
    chunks.push(clean.slice(i, i + size).trim());
    if (i + size >= clean.length) break;
    i += size - overlap;
  }
  return chunks.filter(Boolean);
}
function die(label, error) {
  if (error) {
    console.error(`❌ ${label}:`, error.message || error);
    process.exit(1);
  }
}

async function getOrCreateAdmin() {
  const created = await db.auth.admin.createUser({
    email: adminEmail,
    password: adminPassword,
    email_confirm: true,
    user_metadata: { full_name: 'Switch & Save Admin' },
  });
  if (!created.error) return created.data.user.id;
  if (!/already|registered|exists/i.test(created.error.message)) {
    console.warn('⚠ Could not create auth user (continuing without login):', created.error.message);
    return null;
  }
  const { data: list } = await db.auth.admin.listUsers();
  const found = list?.users?.find((u) => u.email?.toLowerCase() === adminEmail.toLowerCase());
  if (found) {
    await db.auth.admin.updateUserById(found.id, { password: adminPassword, email_confirm: true });
    return found.id;
  }
  return null;
}

// ---- 1. clean slate -------------------------------------------------------
console.log('🌱 Seeding SWITCH&SAVE demo…');
const { data: existing } = await db.from('companies').select('id').eq('slug', SLUG).maybeSingle();
if (existing) {
  await db.from('companies').delete().eq('id', existing.id);
  console.log('   cleared previous demo company');
}

// ---- 2. company -----------------------------------------------------------
const { data: company, error: cErr } = await db
  .from('companies')
  .insert({
    name: 'SWITCH&SAVE Business Services Ltd',
    website: 'https://switch-and-save.uk',
    country: 'GB',
    timezone: 'Europe/London',
    default_language: 'en',
    status: 'active',
    slug: SLUG,
  })
  .select('id')
  .single();
die('create company', cErr);
const companyId = company.id;
console.log('   ✓ company', companyId);

// ---- 3. admin login + membership -----------------------------------------
const adminId = await getOrCreateAdmin();
if (adminId) {
  await db.from('users').upsert({ id: adminId, email: adminEmail, full_name: 'Switch & Save Admin' }, { onConflict: 'id' });
  await db
    .from('company_users')
    .upsert({ company_id: companyId, user_id: adminId, role: 'company_admin' }, { onConflict: 'company_id,user_id' });
  console.log('   ✓ company admin:', adminEmail);
}

// ---- 4. subscription (generous, never blocks chat) ------------------------
await db.from('subscriptions').upsert(
  { company_id: companyId, plan: 'pro', status: 'active', message_limit: null, bot_limit: 5, agent_limit: 10, integration_limit: 10 },
  { onConflict: 'company_id' },
);

// ---- 5. business profile --------------------------------------------------
die(
  'business profile',
  (
    await db.from('company_business_profiles').upsert(
      {
        company_id: companyId,
        short_description:
          'SWITCH&SAVE supplies AI-powered EPOS (point-of-sale) systems, integrated card machines, and business finance for UK retail and hospitality businesses. FCA authorised (FRN 1052230).',
        industry: 'EPOS systems & card payments',
        target_customers:
          'UK retail shops, supermarkets, convenience stores, restaurants, cafés, takeaways, bars, pubs, and multi-location operators.',
        brand_voice: 'Friendly, clear, no jargon, no pushy sales.',
        unique_selling_points:
          'AI software included (no license fees), next-day UK delivery, 7-day returns, free UK-based support 7 days a week, transparent pricing with no hidden fees.',
        primary_phone: '0333 0389707',
        support_email: 'hello@switch-and-save.uk',
        sales_email: 'hello@switch-and-save.uk',
        whatsapp: '+447432391811',
        public_address: '3A Perry Common Road, Erdington, Birmingham, B23 7AB',
        service_areas: 'United Kingdom (next-day delivery nationwide)',
        default_currency: 'GBP',
        payment_methods: ['Card', 'Bank transfer', 'Business finance (YouLend / 365 Finance)'],
        escalation_rules:
          'If the visitor wants a person, has a complex finance query, or reports a fault, offer to connect them to the team or capture their details.',
        lead_qualification_rules:
          'For buying interest, collect name + business name + phone or email, and the business type (retail or hospitality).',
        appointment_rules:
          'Demos are a free 20–30 minute remote walkthrough, weekdays only (Mon–Fri). No same-day demos. Collect name, contact, and preferred weekday/time.',
      },
      { onConflict: 'company_id' },
    )
  ).error,
);
console.log('   ✓ business profile');

// ---- 6. location ----------------------------------------------------------
await db.from('company_locations').insert({
  company_id: companyId,
  name: 'Head office',
  address_line1: '3A Perry Common Road',
  address_line2: 'Erdington',
  city: 'Birmingham',
  region: 'West Midlands',
  country: 'United Kingdom',
  postal_code: 'B23 7AB',
  timezone: 'Europe/London',
  phone: '0333 0389707',
  service_area: 'United Kingdom (next-day delivery)',
  is_primary: true,
});

// ---- 7. business hours (company-level: location_id null) ------------------
const hours = [0, 1, 2, 3, 4, 5, 6].map((d) => {
  const weekday = d >= 1 && d <= 5;
  return {
    company_id: companyId,
    location_id: null,
    day_of_week: d,
    is_closed: !weekday,
    open_time: weekday ? '09:00' : null,
    close_time: weekday ? '17:30' : null,
    notes: weekday ? null : 'Office closed — support available 7 days a week',
  };
});
await db.from('company_business_hours').insert(hours);
console.log('   ✓ location + hours');

// ---- 8. services ----------------------------------------------------------
await db.from('company_services').insert([
  { company_id: companyId, name: 'Retail EPOS — Integrated Payments Bundle', category: 'Retail EPOS', description: 'AI EPOS + integrated card terminal + cloud dashboard. £549 upfront + £30/month per device.', price_from: 549, currency: 'GBP', booking_required: false, is_active: true },
  { company_id: companyId, name: 'Retail EPOS — Standard Bundle', category: 'Retail EPOS', description: 'AI EPOS + card terminal. £649 upfront + £20/month per device.', price_from: 649, currency: 'GBP', is_active: true },
  { company_id: companyId, name: 'Retail EPOS — Premium Upfront Bundle', category: 'Retail EPOS', description: 'Lowest monthly cost. £749 upfront + £12/month per device.', price_from: 749, currency: 'GBP', is_active: true },
  { company_id: companyId, name: 'Hospitality EPOS System', category: 'Hospitality EPOS', description: 'AI hospitality EPOS with kitchen display screens, table management, and order processing. From £349 upfront.', price_from: 349, currency: 'GBP', is_active: true },
  { company_id: companyId, name: 'Integrated Card Machines', category: 'Payments', description: 'Integrated payment terminals via Teya, Worldpay, EVO Payments and TakePayments.', currency: 'GBP', is_active: true },
  { company_id: companyId, name: 'Business Finance', category: 'Finance', description: 'Business funding through our partners YouLend and 365 Finance.', currency: 'GBP', is_active: true },
  { company_id: companyId, name: 'Free EPOS Demo', category: 'Demo', description: 'Free 20–30 minute remote walkthrough of the EPOS system. Weekdays only.', duration_minutes: 30, booking_required: true, is_active: true },
]);

// ---- 9. policies ----------------------------------------------------------
await db.from('company_policies').insert([
  { company_id: companyId, title: 'Returns & refunds', category: 'returns', content: 'We offer a 7-day hassle-free return policy on hardware. Contact hello@switch-and-save.uk to arrange a return.', is_active: true },
  { company_id: companyId, title: 'Delivery', category: 'delivery', content: 'Next-day delivery across the UK on in-stock hardware.', is_active: true },
  { company_id: companyId, title: 'Privacy & data retention', category: 'privacy', content: 'We use cookies for essential functions, analytics and advertising. Chat messages and contact details are retained for up to 40 days for support purposes.', is_active: true },
  { company_id: companyId, title: 'Pricing transparency', category: 'pricing', content: 'No hidden fees. Transparent pricing. AI software is included with no license fees. All prices exclude VAT unless stated.', is_active: true },
]);
console.log('   ✓ services + policies');

// ---- 10. FAQs -------------------------------------------------------------
const faqs = [
  ['What does Switch & Save do?', 'We supply AI-powered EPOS systems, integrated card machines and business finance for UK retail and hospitality businesses.', 'general'],
  ['How much does a retail EPOS system cost?', 'Retail bundles: Integrated Payments £549 upfront + £30/month, Standard £649 + £20/month, and Premium Upfront £749 + £12/month. All prices + VAT.', 'pricing'],
  ['How much is the hospitality EPOS?', 'Our AI hospitality EPOS starts from £349 upfront and includes kitchen display screens, table management and order processing.', 'pricing'],
  ['Do you provide card machines?', 'Yes — integrated card terminals come with our EPOS bundles, supported by partners like Teya, Worldpay, EVO Payments and TakePayments.', 'products'],
  ['How do I book a demo?', 'Book a free 20–30 minute remote demo. Demos run on weekdays only and we don’t offer same-day slots. Share your name, contact and a preferred weekday/time and we’ll arrange it.', 'demo'],
  ['Where are you based?', 'Our head office is at 3A Perry Common Road, Erdington, Birmingham, B23 7AB. We deliver next-day across the UK.', 'contact'],
  ['What are your opening hours?', 'Monday to Friday, 9:00am–5:30pm. Technical support is available 7 days a week.', 'hours'],
  ['What is your return policy?', 'We offer a 7-day hassle-free return policy on hardware.', 'returns'],
  ['How fast is delivery?', 'Next-day delivery across the UK on in-stock items.', 'delivery'],
  ['Do you offer business finance?', 'Yes — we arrange business funding through our partners YouLend and 365 Finance.', 'finance'],
  ['Are there any hidden fees?', 'No. Pricing is transparent and the AI software is included with no license fees.', 'pricing'],
  ['Is the software cloud-based?', 'Yes. You get a cloud dashboard with real-time sales and inventory reporting and multi-store support.', 'features'],
  ['Do you support multiple locations?', 'Yes — multi-terminal and multi-store support is included.', 'features'],
  ['Is technical support free?', 'Yes — free UK-based technical support, 7 days a week.', 'support'],
  ['Are you regulated?', 'Yes. We are FCA authorised (FRN 1052230). Company registration 15051352, VAT GB504915794.', 'trust'],
  ['How do I contact you?', 'Call 0333 0389707, email hello@switch-and-save.uk, or WhatsApp +44 7432 391811.', 'contact'],
];
await db.from('company_faqs').insert(
  faqs.map(([question, answer, category]) => ({ company_id: companyId, question, answer, category, is_active: true })),
);
console.log(`   ✓ ${faqs.length} FAQs`);

// ---- 11. knowledge documents + chunks (RAG) -------------------------------
const docs = [
  {
    title: 'About SWITCH&SAVE',
    text: 'SWITCH&SAVE Business Services Ltd is a UK company that supplies and supports AI-powered EPOS (electronic point-of-sale) systems, integrated card machines, and business finance for retail and hospitality businesses. We are FCA authorised (FRN 1052230), company registration number 15051352, VAT number GB504915794. Our official partners include 365 Finance, EVO Payments, YouLend, Teya UK, Worldpay and TakePayments. Customers rate us 4.9/5 on Google and 5.0/5 on Trustpilot. We serve retail shops, supermarkets, convenience stores, restaurants, cafés, takeaways, bars, pubs, mobile retailers and multi-location operators across the UK.',
  },
  {
    title: 'EPOS pricing and bundles',
    text: 'We offer three retail EPOS bundles. The Integrated Payments Bundle is £549 upfront plus £30 per month per device. The Standard Bundle is £649 upfront plus £20 per month. The Premium Upfront Bundle is £749 upfront plus £12 per month — the lowest ongoing cost. Our Hospitality EPOS starts at £349 upfront and includes kitchen display screens, table management and order processing. All systems include AI-powered software with no license fees, cloud dashboard access, real-time sales and inventory reporting, multi-terminal and multi-store support, free UK-based technical support, barcode scanning, receipt printing and cash-drawer integration. A typical bundle is £549 + VAT upfront and £30 per month per device. There are no hidden fees and pricing is transparent.',
  },
  {
    title: 'Booking a free demo',
    text: 'You can book a free EPOS demo — a remote 20 to 30 minute walkthrough of the system with our team. Demos are available on weekdays only (Monday to Friday) and we do not offer same-day demos. To book, share your name, business name, contact number or email, and a preferred weekday and time. The demo shows how the AI EPOS handles sales, stock control, reporting and card payments for your type of business.',
  },
  {
    title: 'Delivery, returns and support',
    text: 'We deliver next-day across the UK on in-stock hardware. We offer a 7-day hassle-free return policy on hardware. Technical support is free and UK-based and available 7 days a week, even though our office hours are Monday to Friday 9:00am to 5:30pm. If your system has an issue, contact us by phone, email or WhatsApp and our technicians will help — in some cases we attend on-site.',
  },
  {
    title: 'Hardware and features',
    text: 'Our EPOS systems include AI-powered software, a cloud-based dashboard, real-time sales and inventory reporting, and multi-terminal and multi-store support. Retail features include barcode scanning, receipt printing and cash-drawer integration. Hospitality features include kitchen display screens, table management, order processing and stock control. We also supply integrated card machines and digital signage screens. Everything is designed to run your retail or hospitality business faster and smarter.',
  },
  {
    title: 'Card payments and business finance',
    text: 'Card payments are handled by integrated terminals through our payment partners, including Teya UK, Worldpay, EVO Payments and TakePayments. We also help businesses access funding through our finance partners YouLend and 365 Finance, so you can spread the cost of new equipment or invest in growth. Speak to our team for current rates and eligibility.',
  },
];

let chunkTotal = 0;
for (const doc of docs) {
  const { data: d, error: dErr } = await db
    .from('documents')
    .insert({ company_id: companyId, title: doc.title, source_type: 'text', status: 'ready', char_count: doc.text.length })
    .select('id')
    .single();
  die('document', dErr);
  const pieces = chunkText(doc.text);
  const docContext = doc.text.replace(/\s+/g, ' ').trim().slice(0, 240);
  const rows = pieces.map((p, idx) => {
    const contextual = `${doc.title}\n${docContext}\n\n${p}`.trim();
    return {
      company_id: companyId,
      document_id: d.id,
      text: p,
      contextual_text: contextual,
      embedding: JSON.stringify(mockEmbed(contextual)),
      metadata_json: { chunk_index: idx },
    };
  });
  die('chunks', (await db.from('chunks').insert(rows)).error);
  chunkTotal += rows.length;
}
console.log(`   ✓ ${docs.length} knowledge docs (${chunkTotal} chunks)`);

// ---- 12. products + inventory --------------------------------------------
const products = [
  ['Retail EPOS — Integrated Payments Bundle', '£549 upfront + £30/month per device. AI EPOS, integrated card terminal, cloud dashboard.', 'Retail EPOS', 549, 'EPOS-RET-INT'],
  ['Retail EPOS — Standard Bundle', '£649 upfront + £20/month per device.', 'Retail EPOS', 649, 'EPOS-RET-STD'],
  ['Retail EPOS — Premium Upfront Bundle', '£749 upfront + £12/month per device. Lowest monthly cost.', 'Retail EPOS', 749, 'EPOS-RET-PRE'],
  ['Hospitality EPOS System', 'AI hospitality EPOS with kitchen display, table management and order processing.', 'Hospitality EPOS', 349, 'EPOS-HOSP'],
  ['Integrated Card Machine', 'Integrated payment terminal with low transaction fees.', 'Payments', 0, 'CARD-INT'],
  ['Digital Signage Screen', 'In-store digital signage screen for promotions and menus.', 'Signage', 0, 'SIGNAGE-01'],
];
for (const [title, description, category, price, sku] of products) {
  const { data: p } = await db
    .from('synced_products')
    .insert({ company_id: companyId, title, description, category, price, currency: 'GBP', sku, status: 'active' })
    .select('id')
    .single();
  if (p) {
    await db.from('synced_inventory').insert({ company_id: companyId, product_id: p.id, quantity: 50, in_stock: true, location: 'UK warehouse' });
  }
}
console.log(`   ✓ ${products.length} products + inventory`);

// ---- 13. sample order (test order tracking) -------------------------------
await db.from('synced_orders').insert({
  company_id: companyId,
  order_number: 'SS-1001',
  customer_name: 'John Smith',
  customer_email: 'john@example.com',
  customer_phone: '+447700900123',
  status: 'processing',
  fulfillment_status: 'preparing for dispatch',
  tracking_number: 'TRK123456GB',
  tracking_url: 'https://track.example.com/TRK123456GB',
  total: 658.8,
  currency: 'GBP',
  placed_at: new Date(Date.now() - 3 * 86400000).toISOString(),
});
console.log('   ✓ sample order SS-1001 (verify with phone +447700900123 or john@example.com)');

// ---- 14. bot --------------------------------------------------------------
const systemPrompt = [
  'You are the AI assistant for SWITCH&SAVE Business Services Ltd, a UK supplier of AI-powered EPOS systems, integrated card machines, and business finance for retail and hospitality businesses.',
  'Be friendly, clear and concise — no jargon and no pushy sales. Help visitors understand our products and pricing, recommend the right EPOS bundle for their business type, answer support questions, capture sales leads, and book free demos.',
  'Ground rules: only state prices, stock, policies and order details from the provided business information and tools — never invent them. Order details require the order number plus phone or email. When relevant, mention the free demo and next-day UK delivery. If you cannot help or the visitor asks for a person, offer to connect them to the team or take their contact details. Never ask for card details in the chat.',
  'Reply in the customer’s language (English or Arabic, including Gulf dialect and Arabizi).',
].join('\n\n');

const capabilities = ['help_desk', 'sales_agent', 'lead_capture', 'appointment_booking', 'product_stock_assistant', 'order_tracking', 'human_agent_takeover', 'live_chat'];

const { data: bot, error: bErr } = await db
  .from('bots')
  .insert({
    company_id: companyId,
    name: 'Switch & Save Assistant',
    bot_type: 'hybrid_business_assistant',
    system_prompt: systemPrompt,
    language_default: 'en',
    capability_flags: capabilities,
    public_bot_id: PUBLIC_BOT_ID,
    domain_allowlist: [],
    ai_enabled: true,
  })
  .select('id')
  .single();
die('create bot', bErr);
await db
  .from('bot_settings')
  .upsert(
    {
      bot_id: bot.id,
      key: 'prompt_config',
      value_json: { industry: 'EPOS & card payments', tone: 'friendly', customInstructions: 'Mention the free demo and next-day UK delivery when relevant. Encourage serious buyers to book a demo.' },
    },
    { onConflict: 'bot_id,key' },
  );
console.log('   ✓ bot', PUBLIC_BOT_ID);

// ---- 15. eval questions (Quality Room / graded eval) ----------------------
const evalQs = [
  ['How much does the retail EPOS system cost?', 'pricing', false],
  ['What are your opening hours?', 'hours', false],
  ['Do you deliver to Scotland?', 'delivery', false],
  ['Can I book a demo for today?', 'demo', false],
  ['Do you offer business finance?', 'finance', false],
  ['What is your return policy?', 'returns', false],
  ['Where are you based?', 'contact', false],
  ['Do you sell solar panels?', 'out_of_scope', true],
];
await db.from('eval_questions').insert(
  evalQs.map(([question, , mustNot]) => ({ company_id: companyId, question, language: 'en', must_not_answer_if_missing: mustNot })),
);
console.log(`   ✓ ${evalQs.length} eval questions`);

// ---- done -----------------------------------------------------------------
const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
console.log('\n🎉 Demo ready!\n');
console.log('  Test the chat widget:');
console.log(`    ${appUrl}/widget/preview.html?bot=${PUBLIC_BOT_ID}`);
console.log(`    (or open public/widget/demo.html with data-bot-id="${PUBLIC_BOT_ID}")`);
console.log('\n  Dashboard login (company admin):');
console.log(`    ${appUrl}/login   →   ${adminEmail} / ${adminPassword}`);
console.log('\n  Try asking the bot:');
console.log('    • "How much is the retail EPOS?"   • "Book me a demo"');
console.log('    • "Where is my order SS-1001?" (phone +447700900123)');
console.log('    • "Do you deliver to Scotland?"    • بكم نظام نقاط البيع؟');
process.exit(0);
