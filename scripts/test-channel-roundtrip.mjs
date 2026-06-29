// Round-trip validation: an inbound WhatsApp (Twilio) message must create a
// conversation, run the AI pipeline, answer inline (TwiML), save messages under
// the RIGHT company, reuse the conversation on a follow-up, and never touch
// another tenant's data. Requires the dev server running + .env.local.
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const APP = process.env.APP_URL || 'http://localhost:3000';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, secret, { auth: { persistSession: false } });

let failures = 0;
const check = (label, cond) => {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures++;
};

const NUM_A = '+15550000001';
const NUM_B = '+15550000002';
const CUSTOMER = '+15551234567';

async function twilioInbound(toNumber, fromNumber, body) {
  const form = new URLSearchParams({
    From: `whatsapp:${fromNumber}`,
    To: `whatsapp:${toNumber}`,
    Body: body,
    MessageSid: 'SM' + Math.random().toString(36).slice(2),
  });
  const res = await fetch(`${APP}/api/webhooks/twilio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  return { status: res.status, xml: await res.text() };
}

async function seedTenant(name, number) {
  const { data: company } = await admin.from('companies').insert({ name }).select('id').single();
  const { data: bot } = await admin
    .from('bots')
    .insert({
      company_id: company.id,
      name: `${name} Bot`,
      ai_enabled: true,
      system_prompt: 'You are a friendly support assistant. Keep replies short.',
    })
    .select('id, public_bot_id')
    .single();
  await admin.from('channel_identities').insert({
    company_id: company.id,
    bot_id: bot.id,
    channel: 'whatsapp',
    external_id: number,
    settings_json: { provider: 'twilio' },
    is_active: true,
  });
  return { companyId: company.id, botId: bot.id };
}

let A, B;
try {
  A = await seedTenant('QA Tenant A', NUM_A);
  B = await seedTenant('QA Tenant B', NUM_B);

  // 1. Inbound message to Tenant A's number → inline answer.
  const r1 = await twilioInbound(NUM_A, CUSTOMER, 'Hi, what are your opening hours?');
  check('Webhook returns 200 TwiML', r1.status === 200 && r1.xml.includes('<Response>'));
  check('AI produced an inline answer (<Message>)', /<Message>[^<]*\S[^<]*<\/Message>/.test(r1.xml));

  // 2. A conversation was created under Tenant A, on the whatsapp channel.
  const { data: convA } = await admin
    .from('conversations')
    .select('id, company_id, channel, visitor_id')
    .eq('company_id', A.companyId);
  check('Exactly one conversation created for Tenant A', (convA?.length ?? 0) === 1);
  check('Conversation is on the whatsapp channel', convA?.[0]?.channel === 'whatsapp');
  check('Conversation scoped to the visitor number', convA?.[0]?.visitor_id === CUSTOMER);
  const convId = convA?.[0]?.id;

  // 3. Both the visitor message and an AI reply were saved under Tenant A.
  const { data: msgs } = await admin
    .from('messages')
    .select('sender_type, company_id')
    .eq('conversation_id', convId);
  check('Visitor message saved', msgs?.some((m) => m.sender_type === 'visitor'));
  check('AI reply saved', msgs?.some((m) => m.sender_type === 'ai'));
  check('All messages scoped to Tenant A', (msgs ?? []).every((m) => m.company_id === A.companyId));

  // 4. Follow-up reuses the SAME conversation (memory), not a new one.
  await twilioInbound(NUM_A, CUSTOMER, 'And on weekends?');
  const { count: convCountA } = await admin
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', A.companyId);
  check('Follow-up reuses the same conversation', convCountA === 1);

  // 5. TENANT ISOLATION: nothing was created under Tenant B.
  const { count: convCountB } = await admin
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', B.companyId);
  check('No conversation leaked into Tenant B', (convCountB ?? 0) === 0);
  const { count: msgCountB } = await admin
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', B.companyId);
  check('No message leaked into Tenant B', (msgCountB ?? 0) === 0);
} catch (err) {
  console.error('❌ Test run error:', err.message);
  failures++;
} finally {
  if (A?.companyId) await admin.from('companies').delete().eq('id', A.companyId);
  if (B?.companyId) await admin.from('companies').delete().eq('id', B.companyId);
  console.log('🧹 Cleaned up.');
}

console.log(failures === 0 ? '\n🎉 Channel round-trip + isolation verified.' : `\n❌ ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
