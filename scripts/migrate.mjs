// Applies SQL migrations in supabase/migrations/ in order, tracking applied
// files in a public._migrations table. Idempotent: re-running only applies new
// files. Each migration runs in its own transaction; a failure rolls back and
// stops.
//
// Usage: node scripts/migrate.mjs            (reads DATABASE_URL from .env.local)
import { config } from 'dotenv';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import dns from 'node:dns/promises';
import pg from 'pg';

config({ path: '.env.local' });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL || DATABASE_URL.includes('[YOUR-PASSWORD]')) {
  console.error(
    '❌ DATABASE_URL is not set in .env.local.\n' +
      '   Supabase dashboard → Settings → Database → Connection string → URI\n' +
      '   Use the Session pooler (port 5432) URI and replace [YOUR-PASSWORD].',
  );
  process.exit(1);
}

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
