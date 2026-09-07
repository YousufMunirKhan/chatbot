-- ===========================================================================
-- Migration 0066 — Access path for the WhatsApp 24h service window
--
-- WHY: Meta delivers a free-form WhatsApp message only within 24 hours of the
-- customer's last inbound one, and the send path now checks that before it
-- posts. Every outbound text therefore asks a new question — "when did this
-- number last write to us?" — that `messages` could not answer cheaply. 0005
-- indexes (conversation_id, created_at) and company_id alone; 0060 added
-- (company_id, created_at desc) filtered to visitor messages, which orders by
-- time with no way to jump to one sender. Answering from those means walking
-- the company's inbound history newest-first until the sender turns up, and on
-- a broadcast that is one such walk per recipient.
--
-- The index is partial on `sender_type = 'visitor'` because an outbound message
-- never opens a window, which keeps it to the inbound half of the table.
-- `channel` is a key column rather than a second predicate so Messenger and
-- Instagram — which have the same 24h rule — are served by the same index when
-- their send paths adopt the check.
--
-- No new table, and therefore no new RLS policies: `public.messages` already
-- enables row level security with the `_select_members` / `_super_admin_all`
-- pair from 0005, and an index changes only how rows are found, never which
-- rows a policy allows. The lookup itself runs through the service-role client
-- inside a function that filters on the session company's id.
-- ===========================================================================

create index if not exists idx_messages_inbound_by_sender
  on public.messages(company_id, channel, sender_id, created_at desc)
  where sender_type = 'visitor';
