-- ===========================================================================
-- Migration 0011 — AI usage logs (Module 20)
-- Every AI call (chat/embedding/rerank/contextualize/tool_call) logs token
-- usage + estimated cost, powering company analytics and super-admin profit/loss.
-- ===========================================================================

create table if not exists public.ai_usage_logs (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  bot_id          uuid references public.bots(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  provider        text not null,
  model           text not null,
  operation_type  text not null
                    check (operation_type in ('chat','embedding','rerank','contextualize','tool_call')),
  input_tokens    integer not null default 0,
  output_tokens   integer not null default 0,
  estimated_cost  numeric(12,6) not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists idx_ai_usage_company on public.ai_usage_logs(company_id, created_at desc);
create index if not exists idx_ai_usage_company_created on public.ai_usage_logs(company_id, created_at);

alter table public.ai_usage_logs enable row level security;
drop policy if exists ai_usage_logs_super_admin_all on public.ai_usage_logs;
create policy ai_usage_logs_super_admin_all on public.ai_usage_logs
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());
drop policy if exists ai_usage_logs_select_members on public.ai_usage_logs;
create policy ai_usage_logs_select_members on public.ai_usage_logs
  for select to authenticated using (company_id in (select public.user_company_ids()));
