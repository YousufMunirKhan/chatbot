import { config } from 'dotenv';
config({ path: '.env.local' });
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
function getKey() { const r = process.env.ENCRYPTION_KEY || ''; return r.length === 64 ? Buffer.from(r, 'hex') : Buffer.from(r, 'base64'); }
function decrypt(p) { const [iv, tag, d] = p.split('.'); const dc = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(iv, 'base64')); dc.setAuthTag(Buffer.from(tag, 'base64')); return Buffer.concat([dc.update(Buffer.from(d, 'base64')), dc.final()]).toString('utf8'); }
async function setting(key) { const { data } = await db.from('platform_settings').select('value_json,is_secret').eq('key', key).maybeSingle(); if (!data) return null; let v = data.value_json; if (data.is_secret && typeof v === 'string') return decrypt(v); return v; }

const openaiKey = await setting('ai.openai_api_key');
if (!openaiKey) { console.error('No OpenAI key in settings.'); process.exit(1); }

// 1) Verify the OpenAI key works with a real OpenAI model
const t = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + openaiKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'Reply: ok' }], max_tokens: 5 }) });
console.log('OpenAI gpt-4o-mini test:', t.status === 200 ? 'WORKS ✓' : 'FAILED ' + t.status + ' ' + (await t.text()).slice(0,160));

// 2) Reset Option A (OpenAI for chat + embeddings)
const rows = [['ai.chat_provider','openai'],['ai.chat_model','gpt-4o-mini'],['ai.advanced_chat_model','gpt-4o'],['ai.embedding_provider','openai'],['ai.embedding_model','text-embedding-3-small']];
for (const [k,v] of rows) await db.from('platform_settings').upsert({ key:k, value_json:v, is_secret:false }, { onConflict:'key' });
console.log('Reset to Option A (OpenAI gpt-4o-mini + text-embedding-3-small) ✓');

// 3) Re-embed the demo company's chunks with REAL OpenAI embeddings
const { data: company } = await db.from('companies').select('id').eq('slug','switch-and-save').maybeSingle();
const { data: chunks } = await db.from('chunks').select('id,contextual_text,text').eq('company_id', company.id);
console.log('Re-embedding', chunks.length, 'chunks...');
const inputs = chunks.map(c => c.contextual_text || c.text);
const er = await fetch('https://api.openai.com/v1/embeddings', { method:'POST', headers:{ Authorization:'Bearer '+openaiKey, 'Content-Type':'application/json' }, body: JSON.stringify({ model:'text-embedding-3-small', input: inputs }) });
if (er.status !== 200) { console.error('Embedding failed:', er.status, (await er.text()).slice(0,200)); process.exit(1); }
const ej = await er.json();
for (let i = 0; i < chunks.length; i++) {
  await db.from('chunks').update({ embedding: JSON.stringify(ej.data[i].embedding) }).eq('id', chunks[i].id);
}
console.log('Re-embedded', chunks.length, 'chunks with text-embedding-3-small ✓ (dims:', ej.data[0].embedding.length + ')');
process.exit(0);
