-- ===========================================================================
-- Migration 0013 — Evaluation harness (Module 25)
-- Sample questions per bot + run results, to catch RAG/answer regressions.
-- ===========================================================================

create table if not exists public.eval_questions (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies(id) on delete cascade,
  bot_id                 uuid references public.bots(id) on delete cascade,
  question               text not null,
  expected_source        text,
  expected_answer_type   text,
  language               text not null default 'en',
  must_not_answer_if_missing boolean not null default false,
  created_at             timestamptz not null default now()
);
create index if not exists idx_eval_questions_company on public.eval_questions(company_id);

create table if not exists public.eval_runs (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  bot_id      uuid references public.bots(id) on delete cascade,
  total       integer not null default 0,
  passed      integer not null default 0,
  results_json jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_eval_runs_company on public.eval_runs(company_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['eval_questions','eval_runs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_super_admin_all', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin())', t || '_super_admin_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_members', t);
    execute format('create policy %I on public.%I for select to authenticated using (company_id in (select public.user_company_ids()))', t || '_select_members', t);
  end loop;
end$$;
