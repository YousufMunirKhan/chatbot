import { config } from 'dotenv';
config({ path: '.env.local' });
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function getKey() { const r = process.env.ENCRYPTION_KEY || ''; return r.length === 64 ? Buffer.from(r, 'hex') : Buffer.from(r, 'base64'); }
function decrypt(p) { const [iv, tag, d] = p.split('.'); const dc = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(iv, 'base64')); dc.setAuthTag(Buffer.from(tag, 'base64')); return Buffer.concat([dc.update(Buffer.from(d, 'base64')), dc.final()]).toString('utf8'); }

async function setting(key) {
  const { data } = await db.from('platform_settings').select('value_json,is_secret').eq('key', key).maybeSingle();
  if (!data) return null;
  let v = data.value_json;
  if (data.is_secret && typeof v === 'string') { try { return decrypt(v); } catch (e) { return '__DECRYPT_FAILED__: ' + e.message; } }
  return v;
}

console.log('ENCRYPTION_KEY set:', Boolean(process.env.ENCRYPTION_KEY), '| length', (process.env.ENCRYPTION_KEY||'').length);
const provider = await setting('ai.chat_provider');
const model = await setting('ai.chat_model');
const key = await setting('ai.openai_api_key');
console.log('chat_provider:', provider, '| chat_model:', model);
console.log('openai key:', key ? (key.startsWith('__DECRYPT') ? key : key.slice(0,7) + '...('+key.length+' chars)') : 'MISSING');

if (key && !key.startsWith('__DECRYPT')) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: model || 'gpt-4o-mini', messages: [{ role: 'user', content: 'Reply with: ok' }], max_tokens: 5 }),
  });
  console.log('OpenAI test status:', res.status);
  if (!res.ok) console.log('OpenAI error body:', (await res.text()).slice(0, 300));
  else { const j = await res.json(); console.log('OpenAI reply:', j.choices?.[0]?.message?.content); }
}

const { data: company } = await db.from('companies').select('id').eq('slug', 'switch-and-save').maybeSingle();
const { data: runs } = await db.from('eval_runs').select('graded,avg_answer_score,total,passed,created_at').eq('company_id', company.id).order('created_at', { ascending: false }).limit(5);
console.log('\nRecent eval_runs:');
for (const r of runs || []) console.log('  graded=' + r.graded, 'avg=' + r.avg_answer_score, 'passed=' + r.passed + '/' + r.total, r.created_at);
process.exit(0);
