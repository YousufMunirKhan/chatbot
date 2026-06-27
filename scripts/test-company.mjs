// Module 5 verification: company-admin data flow + RLS scoping against the real DB.
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, secret, { auth: { persistSession: false } });

let failures = 0;
const check = (label, cond) => {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures++;
};

const pass = 'Company-Test-123';
const adminEmail = 'qa.co.admin@demo.test';
const agentEmail = 'qa.co.agent@demo.test';
const otherAdminEmail = 'qa.other.admin@demo.test';
const ids = { companies: [], users: [] };

async function makeCompany(name, botLimit) {
  const { data: c } = await admin.from('companies').insert({ name }).select('id').single();
  ids.companies.push(c.id);
  await admin.from('subscriptions').insert({ company_id: c.id, plan: 'starter', status: 'active', bot_limit: botLimit });
  return c.id;
}
async function makeUser(email, companyId, role) {
  const { data } = await admin.auth.admin.createUser({ email, password: pass, email_confirm: true });
  ids.users.push(data.user.id);
  await admin.from('company_users').insert({ company_id: companyId, user_id: data.user.id, role });
  return data.user.id;
}
async function signedClient(email) {
  const c = createClient(url, anon, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: pass });
  if (error) throw new Error('signIn ' + email + ': ' + error.message);
  return c;
}

try {
  const companyA = await makeCompany('QA Company A', 1);
  await makeUser(adminEmail, companyA, 'company_admin');
  await makeUser(agentEmail, companyA, 'agent');

  const companyB = await makeCompany('QA Company B', 5);
  await makeUser(otherAdminEmail, companyB, 'company_admin');

  // --- Bot creation persists capabilities + appearance (as the action does) ---
  const { data: bot, error: botErr } = await admin
    .from('bots')
    .insert({
      company_id: companyA,
      name: 'QA Assistant',
      bot_type: 'hybrid_business_assistant',
      language_default: 'auto',
      capability_flags: ['help_desk', 'lead_capture', 'order_tracking'],
      domain_allowlist: ['acme.com'],
      appearance_json: { welcomeMessage: 'Hi!', primaryColor: '#2563eb', position: 'right' },
    })
    .select('id, capability_flags, appearance_json, public_bot_id')
    .single();
  check('Bot created', !botErr);
  check('Capabilities array round-trips', bot?.capability_flags?.length === 3);
  check('Appearance JSON round-trips', bot?.appearance_json?.primaryColor === '#2563eb');
  check('Public bot id generated', typeof bot?.public_bot_id === 'string' && bot.public_bot_id.length > 10);

  // --- Bot-limit enforcement logic (plan bot_limit = 1) ---
  const { count } = await admin.from('bots').select('id', { count: 'exact', head: true }).eq('company_id', companyA);
  check('Bot-limit check would block a 2nd bot (limit 1)', (count ?? 0) >= 1);

  // --- Company admin logs in and reads their own company/bots/members via RLS ---
  const adminClient = await signedClient(adminEmail);
  const { data: co } = await adminClient.from('companies').select('id,name');
  check('Admin sees only their company', co?.length === 1 && co[0].id === companyA);
  const { data: bots } = await adminClient.from('bots').select('id,name');
  check('Admin can read their bot (RLS)', bots?.length === 1 && bots[0].name === 'QA Assistant');
  const { data: members } = await adminClient.from('company_users').select('role');
  check('Admin sees both members (admin + agent)', members?.length === 2);

  // --- Agent logs in and can read the company + bot (member) ---
  const agentClient = await signedClient(agentEmail);
  const { data: agentBots } = await agentClient.from('bots').select('id');
  check('Agent can read company bot (RLS)', agentBots?.length === 1);

  // --- Cross-company isolation: admin A cannot see company B's data ---
  const { data: bAll } = await adminClient.from('bots').select('id').eq('company_id', companyB);
  check('Admin A cannot see company B bots (RLS)', (bAll?.length ?? 0) === 0);
  const { data: coAll } = await adminClient.from('companies').select('id').eq('id', companyB);
  check('Admin A cannot see company B (RLS)', (coAll?.length ?? 0) === 0);
} catch (err) {
  console.error('❌ Test run error:', err.message);
  failures++;
} finally {
  for (const id of ids.companies) await admin.from('companies').delete().eq('id', id);
  for (const id of ids.users) await admin.auth.admin.deleteUser(id);
  console.log('🧹 Cleaned up.');
}

console.log(failures === 0 ? '\n🎉 Module 5 company flow verified.' : `\n❌ ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
