// Applies SQL migrations in supabase/migrations/ in order, tracking applied
// files in a public._migrations table. Idempotent: re-running only applies new
// files. Each migration runs in its own transaction; a failure rolls back and
// stops.
//
// Usage: node scripts/migrate.mjs                      (uses .env.local)
//        node scripts/migrate.mjs --env .env.production (uses that file instead)
//
// It always prints which database it is about to change before changing it.
// That is not decoration. There is more than one Supabase project now, this
// script reads whichever DATABASE_URL an env file happens to hold, and applying
// a migration to the wrong one is silent — the run succeeds, and production
// simply never receives the change.
import { config } from 'dotenv';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import dns from 'node:dns/promises';
import pg from 'pg';

const argv = process.argv.slice(2);
const envFlag = argv.indexOf('--env');
const ENV_FILE = envFlag === -1 ? '.env.local' : argv[envFlag + 1];
if (envFlag !== -1 && !ENV_FILE) {
  console.error('❌ --env needs a file, e.g. --env .env.production');
  process.exit(1);
}
if (!existsSync(ENV_FILE)) {
  console.error(`❌ ${ENV_FILE} does not exist.`);
  process.exit(1);
}
config({ path: ENV_FILE });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL || DATABASE_URL.includes('[YOUR-PASSWORD]')) {
  console.error(
    `❌ DATABASE_URL is not set in ${ENV_FILE}.\n` +
      '   Supabase dashboard → Settings → Database → Connection string → URI\n' +
      '   Use the Session pooler (port 5432) URI and replace [YOUR-PASSWORD].',
  );
  process.exit(1);
}

// Supabase pooler credentials carry the project ref in the username
// (postgres.<ref>), and the region is the first two segments of the host. Both
// are safe to print; neither is a secret.
function describeTarget(url) {
  try {
    const u = new URL(url);
    const ref = decodeURIComponent(u.username).split('.')[1] ?? '(unknown)';
    const region = u.hostname.split('.')[0] ?? u.hostname;
    return { ref, region, host: u.hostname };
  } catch {
    return { ref: '(unparseable)', region: '(unparseable)', host: '(unparseable)' };
  }
}

const target = describeTarget(DATABASE_URL);
console.log('┌─────────────────────────────────────────────────────────────');
console.log(`│ env file : ${ENV_FILE}`);
console.log(`│ project  : ${target.ref}`);
console.log(`│ region   : ${target.region}`);
console.log('└─────────────────────────────────────────────────────────────');
console.log('');

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

// Build client config, resolving the host explicitly when Node's system
// resolver fails (Supabase direct hosts are often IPv6-only).
async function buildClient() {
  const u = new URL(DATABASE_URL);
  let host = u.hostname;
  try {
    await dns.lookup(host);
  } catch {
    try {
      const a6 = await dns.resolve6(host);
      if (a6[0]) host = a6[0];
    } catch {
      const a4 = await dns.resolve4(host).catch(() => []);
      if (a4[0]) host = a4[0];
    }
  }
  return new pg.Client({
    host,
    port: Number(u.port) || 5432,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.slice(1) || 'postgres',
    ssl: { rejectUnauthorized: false },
  });
}

const client = await buildClient();

async function main() {
  await client.connect();

  await client.query(`
    create table if not exists public._migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    );
  `);

  const { rows } = await client.query('select name from public._migrations');
  const applied = new Set(rows.map((r) => r.name));

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`↷ skip   ${file} (already applied)`);
      continue;
    }
    const sql = readFileSync(join(dir, file), 'utf8');
    process.stdout.write(`▶ apply  ${file} ... `);
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('insert into public._migrations(name) values ($1)', [file]);
      await client.query('COMMIT');
      console.log('✅');
      ran++;
    } catch (err) {
      await client.query('ROLLBACK');
      console.log('❌');
      console.error(`\nMigration ${file} failed:\n${err.message}`);
      process.exit(1);
    }
  }

  console.log(`\nDone. ${ran} migration(s) applied, ${files.length - ran} already up to date.`);
  await client.end();
}

main().catch(async (err) => {
  console.error('❌', err.message);
  try {
    await client.end();
  } catch {}
  process.exit(1);
});
