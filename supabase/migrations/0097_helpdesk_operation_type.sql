-- ===========================================================================
-- Migration 0097 — Let the internal Help Desk assistant's spend be recorded
--
-- `/api/helpdesk/chat` — the assistant staff use inside the dashboard and
-- through the connector — now logs `operation_type = 'helpdesk'` instead of
-- 'chat', for exactly the reason 0092 moved the inbox copilot off 'chat'. The
-- plan's reply allowance is counted as ai_usage_logs rows with
-- operation_type='chat' (`countChatReplies` in src/lib/billing/index.ts), and
-- that allowance is the answers the company bought for THEIR customers to
-- receive. A staffer asking the internal assistant how refunds work is not one
-- of them, and while it was logged as 'chat' every such question took one — so
-- an afternoon of internal questions could switch off the widget those replies
-- were sold for.
--
-- Without this migration that route inserts nothing: the check constraint has
-- never heard of 'helpdesk', `logAiUsage` catches the violation and only warns
-- rather than killing a chat turn, and the credit deduction it wraps
-- (`deductAiCreditForUsage`) never runs. The failure mode is not a broken
-- assistant — it is an assistant that works perfectly and costs the platform
-- real provider money that is never charged to anyone and never appears in a
-- cost report. That silent leak is why this ships in the same change as the
-- code that started emitting the value.
--
-- WHAT READS operation_type, CHECKED BEFORE ADDING A VALUE
-- -------------------------------------------------------
-- Only `countChatReplies` filters on it, and only for 'chat' — which is the
-- whole point of the new value. Every cost and margin figure sums
-- `estimated_cost` with no type filter (`getMonthlyAiCost` in
-- src/lib/ai/cost-controls.ts, `sumAiCostThisMonth` and `getAiCostByCompany` in
-- src/modules/super-admin/data.ts, feeding the super-admin usage, costs and
-- profit screens), so a new type cannot make spend vanish from a report. The
-- customer's credit ledger interpolates the value into its description — rows
-- will read "AI helpdesk usage", which is what happened.
--
-- A check constraint cannot be extended in place, so this drops it and re-adds
-- it with every value from 0011, 0059, 0090 and 0092 repeated verbatim plus the
-- new one. Any future operation type must do the same, and must copy this list.
-- ===========================================================================

alter table public.ai_usage_logs drop constraint if exists ai_usage_logs_operation_type_check;
alter table public.ai_usage_logs
  add constraint ai_usage_logs_operation_type_check
  check (operation_type in
    ('chat','embedding','rerank','contextualize','tool_call','insights','flow_suggestion','copilot','helpdesk'));
