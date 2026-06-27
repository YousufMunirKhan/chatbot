// Module 11 verification: human-takeover rule end-to-end via the chat API.
// (Takeover is applied as sendAgentReplyAction does: ai_enabled=false + human message.)
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

async function chat(publicBotId, visitorId, text, conversationId) {
  const res = await fetch(`${APP}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: APP },
    body: JSON.stringify({ publicBotId, visitorId, text, conversationId }),
  });
  const raw = await res.text();
  const events = raw.split('\n\n').filter((b) => b.startsWith('data:')).map((b) => JSON.parse(b.slice(5).trim()));
  return {
    meta: events.find((e) => e.type === 'meta'),
    tokens: events.filter((e) => e.type === 'token'),
    human: events.find((e) => e.type === 'human'),
  };
}

let companyId, botId, publicBotId, conversationId;
try {
  const { data: company } = await admin.from('companies').insert({ name: 'QA Inbox Co' }).select('id').single();
  companyId = company.id;
  const { data: bot } = await admin
    .from('bots')
    .insert({ company_id: companyId, name: 'QA Inbox Bot', ai_enabled: true, system_prompt: 'You are a bot.' })
    .select('id, public_bot_id')
    .single();
  botId = bot.id;
  publicBotId = bot.public_bot_id;

  // 1. Visitor chats → AI replies (ai_active).
  const r1 = await chat(publicBotId, 'qa-v', 'Hello there');
  conversationId = r1.meta?.conversationId;
  check('AI replies while ai_active', r1.tokens.length > 0 && !r1.human);

  // 2. Agent takes over (as sendAgentReplyAction): pause AI + insert agent message.
  await admin.from('messages').insert({
    company_id: companyId, conversation_id: conversationId,
    sender_type: 'agent', content_text: 'Hi, this is a human agent.',
  });
  await admin.from('conversations').update({ ai_enabled: false, status: 'human_active' }).eq('id', conversationId);

  // 3. Visitor replies during takeover → NO AI, 'human' event, message saved + unread bumped.
  const beforeCount = (await admin.from('messages').select('id', { count: 'exact', head: true }).eq('conversation_id', conversationId)).count ?? 0;
  const r2 = await chat(publicBotId, 'qa-v', 'Are you a real person?', conversationId);
  check('No AI tokens during human takeover', r2.tokens.length === 0);
  check("'human' event sent during takeover", !!r2.human);

  const { data: aiMsgs } = await admin.from('messages').select('id').eq('conversation_id', conversationId).eq('sender_type', 'ai');
  check('Exactly one AI message total (none added during takeover)', (aiMsgs?.length ?? 0) === 1);
  const { data: convo } = await admin.from('conversations').select('unread_count').eq('id', conversationId).single();
  check('Unread count bumped for the agent', (convo?.unread_count ?? 0) >= 1);

  // 4. Widget poll returns the agent message + humanActive.
  const poll = await (await fetch(`${APP}/api/chat/messages?conversationId=${conversationId}&visitorId=qa-v`, { headers: { Origin: APP } })).json();
  check('Poll reports humanActive', poll.humanActive === true);
  check('Poll delivers the agent reply to the widget', poll.messages?.some((m) => m.sender_type === 'agent'));

  // 5. Resume AI → AI replies again.
  await admin.from('conversations').update({ ai_enabled: true, status: 'ai_active' }).eq('id', conversationId);
  const r3 = await chat(publicBotId, 'qa-v', 'Thanks!', conversationId);
  check('AI resumes after resume', r3.tokens.length > 0 && !r3.human);
} catch (err) {
  console.error('❌ Test run error:', err.message);
  failures++;
} finally {
  if (companyId) await admin.from('companies').delete().eq('id', companyId);
  console.log('🧹 Cleaned up.');
}

console.log(failures === 0 ? '\n🎉 Module 11 human-takeover verified.' : `\n❌ ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
