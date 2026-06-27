// Modules 7/9/10 verification: chat pipeline (engine + mock provider + persistence)
// and RAG retrieval RPC, against the real DB + running dev server.
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const APP = process.env.APP_URL || 'http://localhost:3000';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, secret, { auth: { persistSession: false } });

let failures = 0;
const check = (label, cond) => {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures++;
};

let companyId, botId, publicBotId;
try {
  const { data: company } = await admin.from('companies').insert({ name: 'QA Chat Co' }).select('id').single();
  companyId = company.id;
  const { data: bot } = await admin
    .from('bots')
    .insert({
      company_id: companyId,
      name: 'QA Chat Bot',
      bot_type: 'hybrid_business_assistant',
      ai_enabled: true,
      capability_flags: ['help_desk'],
      system_prompt: 'You are QA Chat Bot, a helpful assistant.',
    })
    .select('id, public_bot_id')
    .single();
  botId = bot.id;
  publicBotId = bot.public_bot_id;

  // --- Seed one knowledge chunk (document + chunk with a 1536-dim embedding) ---
  const { data: doc } = await admin
    .from('documents')
    .insert({ company_id: companyId, bot_id: botId, title: 'Policies', status: 'ready' })
    .select('id')
    .single();
  const emb = JSON.stringify(new Array(1536).fill(0.1));
  const { error: chunkErr } = await admin.from('chunks').insert({
    company_id: companyId,
    bot_id: botId,
    document_id: doc.id,
    text: 'Our return policy allows returns within 30 days of purchase.',
    contextual_text: 'Policies\nOur return policy allows returns within 30 days of purchase.',
    embedding: emb,
  });
  check('Knowledge chunk inserted (vector + tsvector)', !chunkErr);

  // --- RAG retrieval RPC ---
  const { data: matches, error: rpcErr } = await admin.rpc('match_chunks', {
    p_company_id: companyId,
    p_bot_id: botId,
    p_query_embedding: emb,
    p_query_text: 'return policy',
    p_match_count: 3,
  });
  check('match_chunks RPC works', !rpcErr && Array.isArray(matches));
  check('RAG returns the seeded chunk', (matches?.length ?? 0) >= 1 && matches[0].text.includes('30 days'));

  // --- Chat pipeline via the public API (SSE) ---
  const res = await fetch(`${APP}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: APP },
    body: JSON.stringify({ publicBotId, visitorId: 'qa-visitor-1', text: 'What is your return policy?' }),
  });
  check('Chat API responds 200', res.status === 200);

  const raw = await res.text();
  const events = raw
    .split('\n\n')
    .filter((b) => b.startsWith('data:'))
    .map((b) => JSON.parse(b.slice(5).trim()));
  const meta = events.find((e) => e.type === 'meta');
  const tokens = events.filter((e) => e.type === 'token');
  const done = events.find((e) => e.type === 'done');
  check('SSE meta event with conversationId', !!meta?.conversationId);
  check('SSE streamed tokens', tokens.length > 0);
  check('SSE done event', !!done);

  const reply = tokens.map((t) => t.value).join('');
  check('Reply used knowledge context (mock cites it)', reply.includes('30 days'));

  // --- Persistence: visitor + ai messages saved ---
  const { data: msgs } = await admin
    .from('messages')
    .select('sender_type, content_text')
    .eq('conversation_id', meta.conversationId)
    .order('created_at', { ascending: true });
  check('Visitor message persisted', msgs?.some((m) => m.sender_type === 'visitor'));
  check('AI message persisted', msgs?.some((m) => m.sender_type === 'ai'));
} catch (err) {
  console.error('❌ Test run error:', err.message);
  failures++;
} finally {
  if (companyId) await admin.from('companies').delete().eq('id', companyId);
  console.log('🧹 Cleaned up.');
}

console.log(failures === 0 ? '\n🎉 Chat + RAG pipeline verified.' : `\n❌ ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
