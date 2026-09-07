// Merge duplicate enquiries created before lead capture became idempotent.
//
// The assistant's save-lead tool used to INSERT on every call, and the model
// calls it whenever it has the details in hand — so one real customer could be
// saved several times inside the same minute. `src/lib/tools/leads.ts` now
// writes one enquiry per conversation, but rows created before that fix are
// still in the table, and a shop owner reading the list would ring the same
// person four times.
//
// This keeps the OLDEST row of each conversation, fills any gap in it from the
// later copies, promotes the furthest-along status a human may have set, and
// deletes the extras.
//
//   node scripts/dedupe-leads.mjs              # show what would change
//   node scripts/dedupe-leads.mjs --apply      # actually change it
//
// A JSON backup of every affected row is written before anything is deleted.
import { config } from 'dotenv';
config({ path: '.env.local' });

import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local');
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false } });

/** Merge-able content. `status` is handled separately. */
const FIELDS = ['name', 'email', 'phone', 'enquiry_type', 'message', 'source_page'];

/** Furthest along wins — a human may have moved one of the copies on. */
const STATUS_ORDER = ['new', 'contacted', 'qualified', 'converted', 'closed'];

const { data: leads, error } = await admin
  .from('leads')
  .select('*')
  .order('created_at', { ascending: true })
  .limit(20000);

if (error) {
  console.error('❌ Could not read leads:', error.message);
  process.exit(1);
}

// Only duplicates WITHIN one conversation are the bug. The same person
// enquiring twice in two separate chats is two real enquiries, and merging
// those would destroy information.
const byConversation = new Map();
for (const lead of leads) {
  if (!lead.conversation_id) continue;
  const list = byConversation.get(lead.conversation_id) ?? [];
  list.push(lead);
  byConversation.set(lead.conversation_id, list);
}

const groups = [...byConversation.values()].filter((rows) => rows.length > 1);

if (groups.length === 0) {
  console.log('✅ No conversation has more than one enquiry. Nothing to do.');
  process.exit(0);
}

const plan = groups.map((rows) => {
  const [keeper, ...extras] = rows;
  const merged = {};
  for (const field of FIELDS) {
    if (keeper[field]) continue; // never overwrite something the keeper already has
    const donor = extras.find((e) => e[field]);
    if (donor) merged[field] = donor[field];
  }
  const best = rows
    .map((r) => r.status)
    .sort((a, b) => STATUS_ORDER.indexOf(b) - STATUS_ORDER.indexOf(a))[0];
  if (best && best !== keeper.status) merged.status = best;
  return { keeper, extras, merged };
});

console.log(`${groups.length} conversation(s) hold more than one enquiry:\n`);
for (const { keeper, extras, merged } of plan) {
  const who = keeper.name || keeper.email || keeper.phone || '(no name)';
  console.log(`  ${who}`);
  console.log(`    keep    ${keeper.id}  created ${keeper.created_at.slice(0, 16)}  status ${keeper.status}`);
  if (Object.keys(merged).length) console.log(`    fill in ${JSON.stringify(merged)}`);
  for (const e of extras) console.log(`    delete  ${e.id}  created ${e.created_at.slice(0, 16)}`);
  console.log('');
}

const affected = plan.flatMap(({ keeper, extras }) => [keeper, ...extras]);

if (!APPLY) {
  console.log('Nothing was changed. Re-run with --apply to make these changes.');
  process.exit(0);
}

const backupPath = `leads-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(backupPath, JSON.stringify(affected, null, 1), 'utf8');
console.log(`Backup of all ${affected.length} affected row(s) written to ${backupPath}`);

let merged = 0;
let deleted = 0;
let failed = 0;

for (const { keeper, extras, merged: fields } of plan) {
  if (Object.keys(fields).length > 0) {
    const { error: updateError } = await admin.from('leads').update(fields).eq('id', keeper.id);
    if (updateError) {
      failed += 1;
      console.error(`  ❌ could not merge into ${keeper.id}: ${updateError.message}`);
      continue; // leave the duplicates in place rather than lose their content
    }
    merged += 1;
  }
  const { error: deleteError } = await admin
    .from('leads')
    .delete()
    .in('id', extras.map((e) => e.id));
  if (deleteError) {
    failed += 1;
    console.error(`  ❌ could not delete duplicates of ${keeper.id}: ${deleteError.message}`);
  } else {
    deleted += extras.length;
  }
}

console.log(`\n✅ merged ${merged} record(s), deleted ${deleted} duplicate row(s), ${failed} failure(s).`);
console.log(`   Restore from ${backupPath} if anything looks wrong.`);
