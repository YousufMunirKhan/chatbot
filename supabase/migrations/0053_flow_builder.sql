-- ===========================================================================
-- Migration 0053 — Visual flow builder (sequences, triggers, sessions, intents)
--
-- A flow is a directed graph of blocks the customer walks through: send a
-- message, ask a question, branch on the answer, call an API, hand off to a
-- human. It runs *before* the AI on every channel; when no flow matches, the
-- assistant answers exactly as it does today.
--
-- The graph is stored as one JSONB document rather than node/edge tables: a
-- running conversation reads the whole graph on every turn, so a single indexed
-- row read beats a multi-table join, and the editor saves atomically.
-- ===========================================================================

create table if not exists public.flows (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  bot_id       uuid references public.bots(id) on delete cascade,
  name         text not null,
  description  text,
  status       text not null default 'draft' check (status in ('draft','live','paused')),
  -- {"nodes":[{id,type,position,data}],"edges":[{id,source,sourceHandle,target}]}
  graph_json   jsonb not null default '{"nodes":[],"edges":[]}'::jsonb,
  -- Empty array = every channel. Otherwise the channel keys this flow serves.
  channels     text[] not null default '{}',
  -- Higher wins when several flows match the same message.
  priority     integer not null default 0,
  version      integer not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_flows_company on public.flows(company_id, updated_at desc);
create index if not exists idx_flows_live on public.flows(company_id, status) where status = 'live';

-- Version history so an edit that breaks a live flow can be rolled back.
create table if not exists public.flow_versions (
  id         uuid primary key default gen_random_uuid(),
  flow_id    uuid not null references public.flows(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  version    integer not null,
  graph_json jsonb not null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_flow_versions on public.flow_versions(flow_id, version);

-- ---------------------------------------------------------------------------
-- Triggers: what starts a flow.
-- ---------------------------------------------------------------------------
create table if not exists public.flow_triggers (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  flow_id     uuid not null references public.flows(id) on delete cascade,
  type        text not null check (type in ('keyword','referral','ad','comment','intent','welcome','event')),
  -- keyword phrase / ref parameter / ad id / intent name / event name.
  match_value text not null default '',
  match_mode  text not null default 'contains' check (match_mode in ('exact','contains','starts_with','regex')),
  channels    text[] not null default '{}',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
-- The hot path: "which triggers could match this inbound message?" — one index
-- scan per company, filtered by type, rather than a table scan.
create index if not exists idx_flow_triggers_lookup
  on public.flow_triggers(company_id, type) where is_active;
create index if not exists idx_flow_triggers_flow on public.flow_triggers(flow_id);

-- ---------------------------------------------------------------------------
-- Sessions: where a conversation currently stands inside a flow.
-- ---------------------------------------------------------------------------
create table if not exists public.flow_sessions (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  flow_id         uuid not null references public.flows(id) on delete cascade,
  -- The node the flow is parked on, waiting for the customer's next message.
  awaiting_node_id text,
  -- Collected answers keyed by variable name, plus internal bookkeeping.
  state_json      jsonb not null default '{}'::jsonb,
  status          text not null default 'running' check (status in ('running','completed','cancelled')),
  started_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
-- One live session per conversation: resuming is a primary-key-speed lookup.
create unique index if not exists uq_flow_sessions_conversation
  on public.flow_sessions(conversation_id) where status = 'running';
create index if not exists idx_flow_sessions_company on public.flow_sessions(company_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- Runs: per-node analytics, so the builder can show where people drop off.
-- ---------------------------------------------------------------------------
create table if not exists public.flow_node_events (
  id              bigserial primary key,
  company_id      uuid not null references public.companies(id) on delete cascade,
  flow_id         uuid not null references public.flows(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  node_id         text not null,
  node_type       text,
  event           text not null check (event in ('entered','answered','completed','abandoned','error')),
  created_at      timestamptz not null default now()
);
create index if not exists idx_flow_node_events_flow
  on public.flow_node_events(flow_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Intents: NLP triggers. Examples are matched by the built-in classifier or by
-- an external NLU provider (wit.ai / INTNT) when one is configured.
-- ---------------------------------------------------------------------------
create table if not exists public.bot_intents (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  bot_id      uuid references public.bots(id) on delete cascade,
  name        text not null,
  description text,
  examples    text[] not null default '{}',
  provider    text not null default 'builtin' check (provider in ('builtin','wit','intnt')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index if not exists uq_bot_intents_name on public.bot_intents(company_id, name);
create index if not exists idx_bot_intents_company on public.bot_intents(company_id) where is_active;

-- NLU provider credentials live on the company, not on each intent.
create table if not exists public.nlu_settings (
  company_id   uuid primary key references public.companies(id) on delete cascade,
  provider     text not null default 'builtin' check (provider in ('builtin','wit','intnt')),
  token_encrypted text,
  settings_json jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS — members read their company's rows; writes go through server actions
-- using the service role, matching the rest of the schema.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'flows','flow_versions','flow_triggers','flow_sessions','flow_node_events','bot_intents','nlu_settings'
  ] loop
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
