-- ===========================================================================
-- Migration 0090 — Suggested guided chats
--
-- "Forty-seven people asked about delivery last month. The assistant was unsure
--  twelve times. Here is a guided chat that answers it properly — publish it?"
--
-- Nobody can copy this feature by copying the product, because it runs on the
-- customer's own transcripts. The suggestion is two halves that must never be
-- confused with each other, and this schema keeps them in separate columns on
-- purpose:
--
--   EVIDENCE  — question_count, conversation_count, low_confidence_count,
--               example_questions, example_conversation_ids. Every one of these
--               is produced by counting rows. No model writes them, and the
--               review screen renders only these as fact. This is the same rule
--               `src/lib/ai/insights/rules.ts` holds: the arithmetic states the
--               numbers, the model only handles language.
--
--   PROPOSAL  — proposed_name and proposed_graph. This is the model's work: a
--               FlowGraph in exactly the shape `src/lib/flows/types.ts` defines.
--               It is stored only after `parseGraph` and `validateGraph` accept
--               it, so a row here always holds a graph the publish gate would
--               pass. A proposal that did not validate is discarded before it
--               reaches the database and is counted on the run instead.
--
-- WHY ONE ROW PER TOPIC, FOREVER
-- ------------------------------
-- `uq_flow_suggestions_fingerprint` is a PLAIN unique index over
-- (company_id, fingerprint) rather than a partial one covering open rows.
-- That is the whole dismissal guarantee: once an owner has said "not relevant",
-- the row stays, carrying its reason, and next week's run finds it and moves on
-- without spending a model call. A partial index would let a dismissed topic
-- come back the moment its count ticked over again — which is precisely the
-- behaviour that makes suggestion features get switched off. (It also cannot
-- serve PostgREST `on_conflict`; the writer upserts on this key.)
-- ===========================================================================

create table if not exists public.flow_suggestion_runs (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  period_days   integer not null default 30,
  period_start  timestamptz not null,
  period_end    timestamptz not null,
  status        text not null default 'running' check (status in ('running','ok','failed','skipped')),
  -- Why a run produced nothing: too little traffic, no AI key, nothing recurring.
  note          text,
  model         text,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  -- How the run spent itself, so "why did I get no suggestions" is answerable
  -- without reading the logs.
  topics_found  integer not null default 0,
  suggested     integer not null default 0,
  -- Proposals the model returned that failed validation and were thrown away.
  rejected      integer not null default 0,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index if not exists idx_flow_suggestion_runs_company
  on public.flow_suggestion_runs(company_id, created_at desc);

create table if not exists public.flow_suggestions (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  run_id        uuid references public.flow_suggestion_runs(id) on delete set null,
  -- Stable id for "this same recurring question", derived from the cluster key.
  fingerprint   text not null,

  -- --- EVIDENCE: arithmetic only -----------------------------------------
  -- A short, deterministic label built from the cluster's own most common
  -- words, e.g. "delivery charges karachi". Not a model's summary.
  topic         text not null,
  keywords      text[] not null default '{}',
  -- The real customer message closest to the middle of the cluster. A quote,
  -- never a paraphrase.
  representative text not null default '',
  question_count      integer not null default 0,
  conversation_count  integer not null default 0,
  -- Answers the assistant gave on this topic that it was not confident about,
  -- counted from answer_quality_logs. "The assistant guessed twelve times."
  low_confidence_count integer not null default 0,
  -- Verbatim customer messages, so a claim can be checked by reading them.
  example_questions   text[] not null default '{}',
  -- Which conversations the count came from (capped; the count is the truth).
  example_conversation_ids uuid[] not null default '{}',
  period_start  timestamptz not null,
  period_end    timestamptz not null,

  -- --- PROPOSAL: the model's work ----------------------------------------
  proposed_name text not null,
  -- {"nodes":[{id,type,position,data}],"edges":[...]} — already validated.
  proposed_graph jsonb not null default '{"nodes":[],"edges":[]}'::jsonb,
  model         text,

  -- --- What the owner did about it ---------------------------------------
  status        text not null default 'new' check (status in ('new','accepted','dismissed')),
  dismissed_reason text
                  check (dismissed_reason is null or dismissed_reason in
                    ('already_answered','not_worth_a_flow','wrong_grouping','bad_draft','other')),
  dismissed_note text,
  dismissed_at  timestamptz,
  dismissed_by  uuid references public.users(id) on delete set null,
  accepted_flow_id uuid references public.flows(id) on delete set null,
  accepted_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- See the header: plain, not partial. One row per topic per company, whatever
-- its status, is what stops a dismissed suggestion returning next week.
create unique index if not exists uq_flow_suggestions_fingerprint
  on public.flow_suggestions(company_id, fingerprint);
create index if not exists idx_flow_suggestions_company
  on public.flow_suggestions(company_id, created_at desc);
-- The review screen's default query: open suggestions, biggest first.
create index if not exists idx_flow_suggestions_open
  on public.flow_suggestions(company_id, conversation_count desc) where status = 'new';

drop trigger if exists trg_flow_suggestions_updated_at on public.flow_suggestions;
create trigger trg_flow_suggestions_updated_at before update on public.flow_suggestions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — members read their own company's rows; every write goes through a
-- server action on the service-role client, exactly as the rest of the schema
-- does. The service role bypasses these policies, so the company_id filter in
-- the data layer remains the isolation boundary.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['flow_suggestion_runs','flow_suggestions'] loop
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
-- Drafting a flow is a real model call and needs its own line in the AI cost
-- reports. A check constraint cannot be extended in place, so this drops it and
-- re-adds it with every existing value repeated verbatim (0011, then 0059) plus
-- the new one.
alter table public.ai_usage_logs drop constraint if exists ai_usage_logs_operation_type_check;
alter table public.ai_usage_logs
  add constraint ai_usage_logs_operation_type_check
  check (operation_type in
    ('chat','embedding','rerank','contextualize','tool_call','insights','flow_suggestion'));
