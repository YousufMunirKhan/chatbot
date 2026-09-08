-- ===========================================================================
-- Migration 0092 — Let the inbox copilot's model spend be recorded
--
-- `draftCopilotReply` (src/lib/ai/copilot.ts) now logs its completions with
-- `operation_type = 'copilot'` instead of 'chat'. That separation is right: the
-- plan's reply allowance is counted as ai_usage_logs rows with
-- operation_type='chat' (src/lib/billing/index.ts), and an agent rewording one
-- message three times must not spend three of the replies the customer bought
-- for THEIR customers to receive.
--
-- But the check constraint on the column has never heard of 'copilot', so every
-- one of those inserts is rejected. That failure is invisible: `logAiUsage`
-- catches and logs a warning rather than killing a chat turn, and the credit
-- deduction it wraps (deductAiCreditForUsage) never runs. The result is not a
-- broken copilot — it is a copilot that works perfectly and costs the platform
-- real provider money that is never charged to anyone and never appears in a
-- cost report. A silent leak is worse than an error, which is why this lands in
-- the same change as the code that started emitting the value.
--
-- A check constraint cannot be extended in place, so this drops it and re-adds
-- it with every value from 0011, 0059 and 0090 repeated verbatim plus the new
-- one. Any future operation type must do the same, and must copy this list.
-- ===========================================================================

alter table public.ai_usage_logs drop constraint if exists ai_usage_logs_operation_type_check;
alter table public.ai_usage_logs
  add constraint ai_usage_logs_operation_type_check
  check (operation_type in
    ('chat','embedding','rerank','contextualize','tool_call','insights','flow_suggestion','copilot'));
