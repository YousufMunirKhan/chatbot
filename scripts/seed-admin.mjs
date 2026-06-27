// Creates (or updates) a platform super-admin login.
// Usage:
//   node scripts/seed-admin.mjs <email> <password>
//   SEED_ADMIN_EMAIL=a@b.com SEED_ADMIN_PASSWORD=secret node scripts/seed-admin.mjs
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.argv[2] || process.env.SEED_ADMIN_EMAIL;
const password = process.argv[3] || process.env.SEED_ADMIN_PASSWORD;

if (!url || !secret) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
if (!email || !password) {
  console.error('Usage: node scripts/seed-admin.mjs <email> <password>');
  process.exit(1);
}

const admin = createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let userId;
const { data: created, error } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { full_name: 'Platform Super Admin' },
});

if (error) {
  if (/already|registered|exists/i.test(error.message)) {
    const { data: list, error: listErr } = await admin.auth.admin.listUsers();
    if (listErr) {
      console.error('❌ Could not list users:', listErr.message);
      process.exit(1);
    }
    const found = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (!found) {
      console.error('❌ User reported existing but not found:', error.message);
      process.exit(1);
    }
    userId = found.id;
    await admin.auth.admin.updateUserById(userId, { password, email_confirm: true });
    console.log('ℹ Existing user found — password reset:', email);
  } else {
    console.error('❌ createUser failed:', error.message);
    process.exit(1);
  }
} else {
  userId = created.user.id;
  console.log('✅ Created auth user:', email);
}

// Promote to platform super admin. Upsert (not update) so it works even when
// the profile row doesn't exist yet (e.g. an auth user created before the
// auto-provision trigger).
const { error: upErr } = await admin
  .from('users')
  .upsert({ id: userId, email, is_super_admin: true }, { onConflict: 'id' });
if (upErr) {
  console.error('❌ Failed to set is_super_admin:', upErr.message);
  process.exit(1);
}

console.log('✅ Super admin ready.');
console.log(`   Log in at /login  →  ${email}`);
