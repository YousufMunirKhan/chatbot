-- ===========================================================================
-- Migration 0059 — AI insights
--
-- Reports say what happened. Insights say what it means and what to do about
-- it: "37 people asked about delivery to Karachi and the assistant could not
-- answer — add it to your business info", "CSAT on WhatsApp dropped from 4.4 to
-- 3.1 after Tuesday", "half the people who start your booking flow leave at the
-- date question".
--
-- Findings are stored rather than generated on page load: the analysis costs a
-- model call over a large evidence pack, so it runs on a schedule (or on
-- demand) and the page reads rows. Storing them also gives the owner a worklist
-- they can tick off, which a regenerated-every-time summary cannot.
-- ===========================================================================

create table if not exists public.ai_insight_runs (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  period_days   integer not null default 30,
  period_start  timestamptz not null,
  period_end    timestamptz not null,
  status        text not null default 'running' check (status in ('running','ok','failed','skipped')),
  -- Why a run produced nothing: not enough conversations, no AI key, etc.
  note          text,
  model         text,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index if not exists idx_ai_insight_runs_company
  on public.ai_insight_runs(company_id, created_at desc);

create table if not exists public.ai_insights (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  run_id        uuid references public.ai_insight_runs(id) on delete cascade,
  -- What the finding is about, so the UI can group and route it.
  category      text not null default 'other'
                  check (category in ('knowledge_gap','answer_quality','response_time','channel','flow','sales','consent','other')),
  severity      text not null default 'info' check (severity in ('critical','warning','info')),
  title         text not null,
  detail        text not null,
  recommendation text,
  /**
   * The numbers the finding was drawn from, so a claim can always be checked:
   * {"metric":"csat","before":4.4,"after":3.1,"sample":52,"channel":"whatsapp"}
   */
  evidence_json jsonb not null default '{}'::jsonb,
  -- Where to go to act on it, e.g. /company/business-data.
  action_href   text,
  action_label  text,
  status        text not null default 'new' check (status in ('new','acknowledged','done','dismissed')),
  -- Deduplicates the same finding across consecutive runs.
  fingerprint   text not null,
  period_start  timestamptz not null,
  period_end    timestamptz not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One open finding per distinct issue: a weekly run re-raising the same gap
-- must update the existing row, not stack a duplicate on the owner's list.
create unique index if not exists uq_ai_insights_open
  on public.ai_insights(company_id, fingerprint)
  where status in ('new','acknowledged');
create index if not exists idx_ai_insights_company
  on public.ai_insights(company_id, created_at desc);
create index if not exists idx_ai_insights_open
  on public.ai_insights(company_id, severity) where status = 'new';

do $$
declare t text;
begin
  foreach t in array array['ai_insight_runs','ai_insights'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_super_admin_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin())',
      t || '_super_admin_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_members', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (company_id in (select public.user_company_ids()))',
      t || '_select_members', t);
  end loop;
end $$;

-- --- Cost attribution -------------------------------------------------------
-- An insights run is a real model call and has to show up in the AI cost
-- reports under its own name; folding it into 'chat' would inflate the
-- per-conversation cost figures the platform prices against.
alter table public.ai_usage_logs drop constraint if exists ai_usage_logs_operation_type_check;
alter table public.ai_usage_logs
  add constraint ai_usage_logs_operation_type_check
  check (operation_type in ('chat','embedding','rerank','contextualize','tool_call','insights'));
