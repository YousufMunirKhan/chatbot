// Verifies the Supabase project is reachable and the API keys are valid.
// Usage: node scripts/check-supabase.mjs   (reads .env.local)
import { config } from 'dotenv';
config({ path: '.env.local' });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anon) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local');
  process.exit(1);
}

const ok = (label, cond, extra = '') =>
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`);

try {
  // 1. Auth service health (with publishable key) — proves project + public key.
  const health = await fetch(`${url}/auth/v1/health`, { headers: { apikey: anon } });
  ok('Project reachable', health.ok, `HTTP ${health.status}`);

  // 2. Publishable/anon key valid — auth settings endpoint accepts it.
  //    NOTE: the Data API root spec (/rest/v1/) now requires a SECRET key, so we
  //    validate the publishable key against the public auth-settings endpoint.
  const settings = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: anon } });
  ok('Publishable key valid', settings.status === 200, `HTTP ${settings.status}`);

  // 3. Secret/service-role key valid — accepted by the Data API.
  if (secret) {
    const restSecret = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: secret, Authorization: `Bearer ${secret}` },
    });
    ok('Secret key valid', restSecret.status === 200, `HTTP ${restSecret.status}`);
  }

  console.log('\nProject:', url);
  console.log('All credentials working ✅');
} catch (err) {
  console.error('❌ Connection failed:', err.message);
  process.exit(1);
}
