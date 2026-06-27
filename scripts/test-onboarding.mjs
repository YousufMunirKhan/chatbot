// Module 4 verification: exercises the onboarding DB flow + aggregation queries
// + company-admin login against the real database, then cleans up.
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

const adminEmail = 'qa.onboard.admin@demo.test';
const pass = 'Onboard-Test-123';
let companyId, adminId;

try {
  // --- Replicate createCompanyAction's server-side sequence ---
  const { data: company, error: cErr } = await admin
    .from('companies')
    .insert({ name: 'QA Onboarded Co', website: 'https://qa.test', default_language: 'auto' })
    .select('id')
    .single();
  if (cErr) throw new Error('company insert: ' + cErr.message);
  companyId = company.id;

  const { error: sErr } = await admin.from('subscriptions').insert({
    company_id: companyId,
    plan: 'growth',
    status: 'active',
    message_limit: 10000,
    bot_limit: 3,
    agent_limit: 10,
    integration_limit: 5,
  });
  check('Subscription created', !sErr);

  const { data: created, error: uErr } = await admin.auth.admin.createUser({
    email: adminEmail,
    password: pass,
    email_confirm: true,
  });
  if (uErr) throw new Error('createUser: ' + uErr.message);
  adminId = created.user.id;

  const { error: mErr } = await admin
    .from('company_users')
    .insert({ company_id: companyId, user_id: adminId, role: 'company_admin' });
  check('Company admin linked', !mErr);

  await admin.from('audit_logs').insert({
    company_id: companyId,
    actor_user_id: adminId,
    action: 'company.onboarded',
    target_type: 'company',
    target_id: companyId,
  });

  // --- Aggregation query used by the dashboard (listCompanies) ---
  const { data: rows, error: aggErr } = await admin
    .from('companies')
    .select(
      'id,name,status,created_at, subscriptions(plan,status,free_until,message_limit), bots(count), company_users(count)',
    )
    .eq('id', companyId);
  check('Aggregation query (embeds + counts) works', !aggErr && (rows?.length ?? 0) === 1);
  const row = rows?.[0];
  const sub = Array.isArray(row?.subscriptions) ? row.subscriptions[0] : row?.subscriptions;
  const memberCount = Array.isArray(row?.company_users)
    ? row.company_users[0]?.count
    : row?.company_users?.count;
  check('Subscription plan = growth via embed', sub?.plan === 'growth');
  check('Member count = 1 via embed', memberCount === 1);

  // --- Audit log recorded ---
  const { data: audits } = await admin
    .from('audit_logs')
    .select('action')
    .eq('company_id', companyId);
  check('Audit log recorded', (audits?.length ?? 0) >= 1);

  // --- The onboarded admin can actually log in ---
  const userClient = createClient(url, anon, { auth: { persistSession: false } });
  const { error: signInErr } = await userClient.auth.signInWithPassword({
    email: adminEmail,
    password: pass,
  });
  check('Onboarded company admin can log in', !signInErr);

  // --- And sees their own company + subscription via RLS ---
  const { data: ownCo } = await userClient.from('companies').select('id');
  check('Admin sees exactly their company (RLS)', ownCo?.length === 1 && ownCo[0].id === companyId);
  const { data: ownSub } = await userClient.from('subscriptions').select('plan');
  check('Admin can read their subscription (RLS)', ownSub?.length === 1 && ownSub[0].plan === 'growth');
} catch (err) {
  console.error('❌ Test run error:', err.message);
  failures++;
} finally {
  if (companyId) await admin.from('companies').delete().eq('id', companyId);
  if (adminId) await admin.auth.admin.deleteUser(adminId);
  console.log('🧹 Cleaned up.');
}

console.log(failures === 0 ? '\n🎉 Module 4 onboarding flow verified.' : `\n❌ ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
