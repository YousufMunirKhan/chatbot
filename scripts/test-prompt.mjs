// Module 6 verification: prompt-config persistence in bot_settings +
// system_prompt sync on the bot, against the real database.
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, secret, { auth: { persistSession: false } });

let failures = 0;
const check = (label, cond) => {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures++;
};

let companyId, botId;
try {
  const { data: company } = await admin.from('companies').insert({ name: 'QA Prompt Co' }).select('id').single();
  companyId = company.id;
  const { data: bot } = await admin
    .from('bots')
    .insert({
      company_id: companyId,
      name: 'QA Bot',
      bot_type: 'hybrid_business_assistant',
      capability_flags: ['help_desk', 'lead_capture'],
    })
    .select('id')
    .single();
  botId = bot.id;

  // 1. Upsert prompt_config (as updatePromptConfigAction does).
  const { error: up1 } = await admin
    .from('bot_settings')
    .upsert({ bot_id: botId, key: 'prompt_config', value_json: { industry: 'restaurant', tone: 'friendly' } }, { onConflict: 'bot_id,key' });
  check('prompt_config saved', !up1);

  // 2. Upsert again (changed) — must update, not duplicate (unique bot_id,key).
  const { error: up2 } = await admin
    .from('bot_settings')
    .upsert({ bot_id: botId, key: 'prompt_config', value_json: { industry: 'clinic', tone: 'warm' } }, { onConflict: 'bot_id,key' });
  check('prompt_config re-saved (upsert)', !up2);

  const { data: settings } = await admin.from('bot_settings').select('value_json').eq('bot_id', botId).eq('key', 'prompt_config');
  check('Exactly one prompt_config row (unique constraint)', settings?.length === 1);
  check('prompt_config holds latest value', settings?.[0]?.value_json?.industry === 'clinic');

  // 3. system_prompt sync (as recomputeBotPrompt does).
  const assembled = 'You are the AI business assistant for QA Prompt Co...';
  const { error: sp } = await admin.from('bots').update({ system_prompt: assembled }).eq('company_id', companyId).eq('id', botId);
  check('system_prompt written to bot', !sp);
  const { data: botRow } = await admin.from('bots').select('system_prompt').eq('id', botId).single();
  check('system_prompt persisted', botRow?.system_prompt === assembled);
} catch (err) {
  console.error('❌ Test run error:', err.message);
  failures++;
} finally {
  if (companyId) await admin.from('companies').delete().eq('id', companyId); // cascades bot + settings
  console.log('🧹 Cleaned up.');
}

console.log(failures === 0 ? '\n🎉 Module 6 persistence verified.' : `\n❌ ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
