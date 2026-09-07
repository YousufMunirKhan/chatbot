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

/**
 * Settings whose absence silently disables a whole feature.
 *
 * These are reported separately from `optionalRecommended` because the failure
 * mode is invisible: without CRON_SECRET no background job runs and nothing
 * says so; without META_APP_SECRET inbound webhooks are refused in production.
 * A green `env:check` that hides that is worse than no check.
 */
const featureGates = [
  ['CRON_SECRET', 'reply-time warnings, broadcasts, order + cart messages, Gmail/YouTube polling, auto top-up'],
  ['META_APP_SECRET', 'WhatsApp / Messenger / Instagram webhooks (REFUSED in production without it)'],
  ['META_VERIFY_TOKEN', 'saving the webhook in the Meta app dashboard'],
  ['GOOGLE_CLIENT_ID', 'the "Connect Gmail" button and Google Calendar'],
  ['GOOGLE_CLIENT_SECRET', 'the "Connect Gmail" button and Google Calendar'],
  ['EMAIL_API_URL', 'replying to inbound email (reading it still works)'],
  ['TIKTOK_CLIENT_SECRET', 'verifying TikTok comment webhooks'],
  ['SHOPIFY_WEBHOOK_SECRET', 'Shopify order automations (webhook returns 503 in production)'],
  ['WOOCOMMERCE_WEBHOOK_SECRET', 'WooCommerce order automations (webhook returns 503 in production)'],
  ['VAPID_PUBLIC_KEY', 'phone alerts (web push) for the dashboard app — the toggle reports "not switched on"'],
  ['VAPID_PRIVATE_KEY', 'phone alerts (web push) — nothing can be signed or delivered without it'],
  ['VAPID_SUBJECT', 'the contact URI push services require; delivery is refused by some without it'],
];

let failed = false;
console.log(`Checking ${fileName}\n`);

for (const key of required) {
  const value = env.get(key);
  const ok = Boolean(value);
  if (!ok) failed = true;
  console.log(`${ok ? 'OK ' : 'MISS'} ${key}${ok ? `=${mask(value)}` : ''}`);
}

const missingGates = featureGates.filter(([key]) => {
  const value = env.get(key);
  // META_APP_SECRET has an accepted alias for single-app deployments.
  if (key === 'META_APP_SECRET' && env.get('WHATSAPP_APP_SECRET')) return false;
  if (key === 'META_VERIFY_TOKEN' && env.get('WHATSAPP_VERIFY_TOKEN')) return false;
  return !value;
});

if (missingGates.length > 0) {
  console.log('');
  console.log('Not set — these features are OFF and will not report an error:');
  for (const [key, effect] of missingGates) console.log(`  OFF  ${key} — ${effect}`);
  // In production an unset feature gate is a deployment mistake, not a choice.
  if (fileName === '.env.production') failed = true;
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
