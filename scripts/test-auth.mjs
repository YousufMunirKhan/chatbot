// End-to-end auth + RLS verification (Module 3 acceptance).
// Creates throwaway users, signs them in with the PUBLISHABLE key (so RLS
// applies as that user), asserts role-based access, then cleans up.
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(url, secret, { auth: { persistSession: false } });
const pass = 'Test-' + 'aB3' + 'xyz!'; // static (Math.random unavailable in some envs)

let failures = 0;
const check = (label, cond) => {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures++;
};

async function makeUser(email) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: pass,
    email_confirm: true,
  });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  return data.user.id;
}

async function signedClient(email) {
  const c = createClient(url, anon, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: pass });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return c;
}

const superEmail = 'qa.super@demo.test';
const adminEmail = 'qa.cadmin@demo.test';
let superId, adminId, companyId;

try {
  // --- Set up: a super admin, a company, and a company admin in that company.
  superId = await makeUser(superEmail);
  await admin.from('users').update({ is_super_admin: true }).eq('id', superId);

  const { data: company, error: cErr } = await admin
    .from('companies')
    .insert({ name: 'QA Company' })
    .select('id')
    .single();
  if (cErr) throw new Error('create company: ' + cErr.message);
  companyId = company.id;

  adminId = await makeUser(adminEmail);
  await admin
    .from('company_users')
    .insert({ company_id: companyId, user_id: adminId, role: 'company_admin' });

  // --- Test 1: super admin logs in and is recognized as super admin.
  const superClient = await signedClient(superEmail);
  const { data: superProfile } = await superClient
    .from('users')
    .select('is_super_admin')
    .eq('id', superId)
    .single();
  check('Super admin logs in and is_super_admin = true', superProfile?.is_super_admin === true);

  // --- Test 2: super admin can read platform_settings (override policy).
  const { data: psSuper } = await superClient.from('platform_settings').select('key');
  check('Super admin can read platform_settings', (psSuper?.length ?? 0) > 0);

  // --- Test 3: company admin logs in and sees their company.
  const adminClient = await signedClient(adminEmail);
  const { data: ownCompany } = await adminClient.from('companies').select('id,name');
  check(
    'Company admin sees exactly their own company',
    ownCompany?.length === 1 && ownCompany[0].id === companyId,
  );

  // --- Test 4: company admin CANNOT read platform_settings (blocked by RLS).
  const { data: psAdmin } = await adminClient.from('platform_settings').select('key');
  check('Company admin is blocked from platform_settings', (psAdmin?.length ?? 0) === 0);

  // --- Test 5: company admin membership role resolves to company_admin.
  const { data: membership } = await adminClient
    .from('company_users')
    .select('role')
    .eq('user_id', adminId)
    .single();
  check('Company admin role = company_admin', membership?.role === 'company_admin');
} catch (err) {
  console.error('❌ Test run error:', err.message);
  failures++;
} finally {
  // --- Cleanup
  try {
    if (companyId) await admin.from('companies').delete().eq('id', companyId);
    if (superId) await admin.auth.admin.deleteUser(superId);
    if (adminId) await admin.auth.admin.deleteUser(adminId);
    console.log('🧹 Cleaned up test users & company.');
  } catch (e) {
    console.error('cleanup warning:', e.message);
  }
}

console.log(failures === 0 ? '\n🎉 All auth/RLS checks passed.' : `\n❌ ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
