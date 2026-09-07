// SLA lifecycle verification against the REAL database.
//
// scripts/test-sla.mjs proves the arithmetic; this proves the lifecycle:
// starting a clock is idempotent, an agent reply and a close stop the right
// clocks, the breach sweep flags each conversation exactly once, and one
// company's policies never govern another's conversations.
//
// Creates its own throwaway companies and deletes them at the end.
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { loadTs, makeChecker } from './lib/ts-load.mjs';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local');
  process.exit(1);
}
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const { check, state } = makeChecker();

const notifications = [];
const modules = await loadTs(['src/lib/sla/index.ts'], {
  '@/lib/db/server': `
    import { createClient } from '@supabase/supabase-js';
    const admin = createClient(${JSON.stringify(url)}, ${JSON.stringify(serviceKey)}, { auth: { persistSession: false } });
    export function createSupabaseServiceClient() { return admin; }
  `,
  '@/lib/logger': `export const logger = { info() {}, warn() {}, error() {}, debug() {} };`,
  // Recorded rather than sent, so the test can assert a breach is announced once.
  '@/lib/notify': `
    globalThis.__slaNotifications = globalThis.__slaNotifications || [];
    export async function notify(p) { globalThis.__slaNotifications.push(p); }
  `,
});
globalThis.__slaNotifications = notifications;

const { startSlaClock, markFirstResponse, markResolved, sweepSlaBreaches } = modules['src/lib/sla/index.ts'];

let companyId = null;
let otherCompanyId = null;

async function makeCompany(name) {
  const { data, error } = await admin.from('companies').insert({ name }).select('id').single();
  if (error) throw new Error(`company insert failed: ${error.message}`);
  return data.id;
}
async function makeBot(cid) {
  const { data, error } = await admin
    .from('bots')
    .insert({ company_id: cid, name: 'QA SLA Bot', bot_type: 'hybrid_business_assistant' })
    .select('id')
    .single();
  if (error) throw new Error(`bot insert failed: ${error.message}`);
  return data.id;
}
async function makeConversation(cid, botId, channel = 'whatsapp') {
  const { data, error } = await admin
    .from('conversations')
    .insert({ company_id: cid, bot_id: botId, channel, status: 'needs_human', visitor_id: `qa-${Math.random()}` })
    .select('id')
    .single();
  if (error) throw new Error(`conversation insert failed: ${error.message}`);
  return data.id;
}
async function makePolicy(cid, over = {}) {
  const { data, error } = await admin
    .from('sla_policies')
    .insert({ company_id: cid, name: 'QA policy', first_response_minutes: 15, ...over })
    .select('id')
    .single();
  if (error) throw new Error(`policy insert failed: ${error.message}`);
  return data.id;
}
const stateOf = async (conversationId) => {
  const { data } = await admin
    .from('sla_states')
    .select('*')
    .eq('conversation_id', conversationId)
    .maybeSingle();
  return data;
};

try {
  companyId = await makeCompany('QA SLA Co');
  otherCompanyId = await makeCompany('QA SLA Other Co');
  const botId = await makeBot(companyId);
  const otherBotId = await makeBot(otherCompanyId);

  const catchAllId = await makePolicy(companyId, { name: 'Catch-all', first_response_minutes: 60, resolution_minutes: 240 });
  const whatsappId = await makePolicy(companyId, {
    name: 'WhatsApp fast',
    applies_channel: 'whatsapp',
    first_response_minutes: 10,
    priority: 5,
  });

  // --- 1. the clock starts on the most specific policy ----------------------
  const waConvo = await makeConversation(companyId, botId, 'whatsapp');
  const started = await startSlaClock({ companyId, conversationId: waConvo, channel: 'whatsapp' });
  check('a clock started', started !== null);
  check('the channel-specific policy was chosen', started?.policyId === whatsappId, started?.policyId);

  const waState = await stateOf(waConvo);
  check('a state row was written', Boolean(waState));
  check('a first-response deadline exists', Boolean(waState?.first_response_due_at));
  check('no resolution deadline when the policy sets none', waState?.resolution_due_at === null);

  const dueIn = (new Date(waState.first_response_due_at) - new Date(waState.started_at)) / 60000;
  check('the deadline is 10 minutes out', Math.round(dueIn) === 10, dueIn);

  // --- 2. a different channel falls back to the catch-all -------------------
  const webConvo = await makeConversation(companyId, botId, 'web_chat');
  const webStarted = await startSlaClock({ companyId, conversationId: webConvo, channel: 'web_chat' });
  check('the catch-all covers other channels', webStarted?.policyId === catchAllId);
  const webState = await stateOf(webConvo);
  check('a resolution deadline is stored when the policy sets one', Boolean(webState?.resolution_due_at));

  // --- 3. starting twice does not extend the deadline -----------------------
  const again = await startSlaClock({ companyId, conversationId: waConvo, channel: 'whatsapp' });
  check('a second start is a no-op', again === null);
  const waStateAgain = await stateOf(waConvo);
  check('the original deadline is untouched', waStateAgain.first_response_due_at === waState.first_response_due_at);

  // --- 4. an agent reply stops the response clock ---------------------------
  await markFirstResponse({ companyId, conversationId: waConvo });
  const responded = await stateOf(waConvo);
  check('the first response was recorded', Boolean(responded?.first_response_at));

  const { data: respondedEvents } = await admin
    .from('sla_events')
    .select('event,minutes')
    .eq('conversation_id', waConvo)
    .eq('event', 'responded');
  check('a responded event was logged', (respondedEvents ?? []).length === 1);
  check('the elapsed time was measured', typeof respondedEvents?.[0]?.minutes === 'number');

  const firstResponseAt = responded.first_response_at;
  await markFirstResponse({ companyId, conversationId: waConvo });
  const respondedTwice = await stateOf(waConvo);
  check('a second reply does not overwrite the first', respondedTwice.first_response_at === firstResponseAt);

  // --- 5. closing stops the resolution clock --------------------------------
  await markResolved({ companyId, conversationId: webConvo });
  const resolved = await stateOf(webConvo);
  check('the resolution was recorded', Boolean(resolved?.resolved_at));

  // --- 6. the breach sweep flags an overdue clock exactly once --------------
  const lateConvo = await makeConversation(companyId, botId, 'whatsapp');
  await startSlaClock({ companyId, conversationId: lateConvo, channel: 'whatsapp' });
  // Backdate the deadline rather than waiting ten minutes.
  const past = new Date(Date.now() - 60_000).toISOString();
  await admin
    .from('sla_states')
    .update({ started_at: past, first_response_due_at: past })
    .eq('conversation_id', lateConvo);

  notifications.length = 0;
  const sweep1 = await sweepSlaBreaches();
  check('the sweep found the overdue clock', sweep1.responseBreaches >= 1, sweep1);
  const breached = await stateOf(lateConvo);
  check('the state row is flagged as breached', breached?.first_response_breached === true);
  const notifiedOnce = notifications.filter((n) => n.data?.conversationId === lateConvo).length;
  check('the breach was announced once', notifiedOnce === 1, notifiedOnce);

  notifications.length = 0;
  await sweepSlaBreaches();
  const notifiedTwice = notifications.filter((n) => n.data?.conversationId === lateConvo).length;
  check('a second sweep does not re-announce it', notifiedTwice === 0, notifiedTwice);

  const { data: breachEvents } = await admin
    .from('sla_events')
    .select('event')
    .eq('conversation_id', lateConvo)
    .eq('event', 'breached_response');
  check('exactly one breach event was logged', (breachEvents ?? []).length === 1);

  // --- 7. an answered conversation is never swept ---------------------------
  const answeredConvo = await makeConversation(companyId, botId, 'whatsapp');
  await startSlaClock({ companyId, conversationId: answeredConvo, channel: 'whatsapp' });
  await admin
    .from('sla_states')
    .update({ started_at: past, first_response_due_at: past })
    .eq('conversation_id', answeredConvo);
  await markFirstResponse({ companyId, conversationId: answeredConvo });
  await sweepSlaBreaches();
  const answered = await stateOf(answeredConvo);
  check('an answered conversation is not breached', answered?.first_response_breached === false);

  // --- 8. TENANT ISOLATION ---------------------------------------------------
  // The other company has a much tighter policy. It must not govern our chats.
  await makePolicy(otherCompanyId, { name: 'Other 1 minute', first_response_minutes: 1, priority: 99 });
  const isoConvo = await makeConversation(companyId, botId, 'whatsapp');
  const isoStarted = await startSlaClock({ companyId, conversationId: isoConvo, channel: 'whatsapp' });
  check("another company's policy is not applied", isoStarted?.policyId === whatsappId, isoStarted?.policyId);

  // And a company with no policies gets no clock at all.
  const thirdCompany = await makeCompany('QA SLA Empty Co');
  const thirdBot = await makeBot(thirdCompany);
  const thirdConvo = await makeConversation(thirdCompany, thirdBot, 'whatsapp');
  const none = await startSlaClock({ companyId: thirdCompany, conversationId: thirdConvo, channel: 'whatsapp' });
  check('no policies means no clock', none === null);
  await admin.from('companies').delete().eq('id', thirdCompany);

  // --- 9. business hours are honoured end to end ----------------------------
  // Closed every day → the elapsed-time fallback still produces a deadline.
  const bhPolicyCompany = await makeCompany('QA SLA Hours Co');
  const bhBot = await makeBot(bhPolicyCompany);
  await admin.from('company_business_hours').insert(
    [0, 1, 2, 3, 4, 5, 6].map((d) => ({
      company_id: bhPolicyCompany,
      day_of_week: d,
      is_closed: d === 0 || d === 6,
      open_time: d === 0 || d === 6 ? null : '09:00',
      close_time: d === 0 || d === 6 ? null : '17:00',
    })),
  );
  await makePolicy(bhPolicyCompany, { name: 'Business hours', first_response_minutes: 30, business_hours_only: true });
  const bhConvo = await makeConversation(bhPolicyCompany, bhBot, 'whatsapp');
  const bhStarted = await startSlaClock({ companyId: bhPolicyCompany, conversationId: bhConvo, channel: 'whatsapp' });
  check('a business-hours policy still produces a deadline', Boolean(bhStarted?.firstResponseDueAt));
  const bhState = await stateOf(bhConvo);
  const bhGap = (new Date(bhState.first_response_due_at) - new Date(bhState.started_at)) / 60000;
  check('the business-hours deadline is at least the target', bhGap >= 30, bhGap);
  await admin.from('companies').delete().eq('id', bhPolicyCompany);

  // --- 10. an inactive policy is ignored -------------------------------------
  await admin.from('sla_policies').update({ is_active: false }).eq('id', whatsappId);
  const pausedConvo = await makeConversation(companyId, botId, 'whatsapp');
  const pausedStart = await startSlaClock({ companyId, conversationId: pausedConvo, channel: 'whatsapp' });
  check('a paused policy is skipped in favour of the next match', pausedStart?.policyId === catchAllId);
} catch (err) {
  console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
  state.failed += 1;
} finally {
  if (companyId) await admin.from('companies').delete().eq('id', companyId);
  if (otherCompanyId) await admin.from('companies').delete().eq('id', otherCompanyId);
}

console.log(`\n${state.failed === 0 ? '✅' : '❌'} SLA lifecycle (database): ${state.passed} passed, ${state.failed} failed`);
process.exit(state.failed === 0 ? 0 : 1);
