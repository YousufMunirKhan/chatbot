import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mode = process.argv[2] || 'local';
const fileName = mode === 'production' || mode === 'live' ? '.env.production' : '.env.local';
const filePath = resolve(process.cwd(), fileName);

function parseEnv(text) {
  const values = new Map();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    values.set(trimmed.slice(0, index).trim(), trimmed.slice(index + 1).trim());
  }
  return values;
}

function mask(value) {
  if (!value) return '';
  if (value.length <= 10) return '<set>';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

if (!existsSync(filePath)) {
  console.error(`Missing ${fileName}`);
  process.exit(1);
}

const env = parseEnv(readFileSync(filePath, 'utf8'));
const required = [
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_WIDGET_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'APP_ENV',
];

const optionalRecommended = [
  'OPENAI_API_KEY',
  'ENCRYPTION_KEY',
  'JWT_SECRET',
  'EMAIL_FROM',
  'RESEND_API_KEY',
];

let failed = false;
console.log(`Checking ${fileName}\n`);

for (const key of required) {
  const value = env.get(key);
  const ok = Boolean(value);
  if (!ok) failed = true;
  console.log(`${ok ? 'OK ' : 'MISS'} ${key}${ok ? `=${mask(value)}` : ''}`);
}

if (fileName === '.env.production') {
  for (const key of ['NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_WIDGET_URL']) {
    const value = env.get(key) || '';
    if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(value)) {
      failed = true;
      console.log(`BAD ${key} still points to localhost`);
    }
  }
  if ((env.get('APP_ENV') || '') !== 'production') {
    failed = true;
    console.log('BAD APP_ENV should be production for live');
  }
}

console.log('\nRecommended for full production features:');
for (const key of optionalRecommended) {
  const value = env.get(key);
  console.log(`${value ? 'OK ' : 'WARN'} ${key}${value ? `=${mask(value)}` : ''}`);
}

if (failed) {
  console.error(`\n${fileName} has missing or invalid required values.`);
  process.exit(1);
}

console.log(`\n${fileName} looks ready.`);
