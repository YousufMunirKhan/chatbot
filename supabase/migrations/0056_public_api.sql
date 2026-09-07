-- ===========================================================================
-- Migration 0056 — Public developer platform (API keys, request log, event catalogue)
-- Companies build ON TOP of the assistant: a `rvk_live_…` bearer key scoped to
-- exactly ONE company authenticates every /api/v1 request.
--
-- Only a SHA-256 hash of the key is stored. `key_prefix` keeps the first 12
-- characters so the console can show "rvk_live_a1b…" next to a key the user can
-- recognise; the plaintext is displayed once at creation and never again, so a
-- database leak cannot be replayed against the API.
--
-- `api_request_logs` is the developer-visible audit trail (and the raw material
-- for per-key usage analysis) — bigserial because it is append-only and hot.
-- `webhook_event_types` is the public catalogue of events a developer can
-- subscribe a webhook endpoint to: the endpoint rows in 0026 store `events` as
-- free text[], so without a catalogue there was nothing to render a picker or
-- a docs table from.
-- ===========================================================================

create table if not exists public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  name         text not null default 'API key',
  -- First 12 chars of the plaintext key ("rvk_live_" + 3) — display only.
  key_prefix   text not null,
  -- SHA-256 hex of the full plaintext key. The only copy we keep.
  key_hash     text not null,
  scopes       text[] not null default '{}',
  last_used_at timestamptz,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
-- Authentication hashes the presented key and looks the row up by prefix, then
-- compares hashes in constant time — both columns are on the hot path.
create unique index if not exists api_keys_hash_key on public.api_keys(key_hash);
create index if not exists api_keys_prefix_idx on public.api_keys(key_prefix);
create index if not exists api_keys_company_idx on public.api_keys(company_id, created_at desc);

create table if not exists public.api_request_logs (
  id          bigserial primary key,
  company_id  uuid not null references public.companies(id) on delete cascade,
  api_key_id  uuid references public.api_keys(id) on delete set null,
  method      text not null,
  path        text not null,
  status      integer not null,
  duration_ms integer,
  ip          text,
  created_at  timestamptz not null default now()
);
-- The developer console reads "latest N requests for my company" on every load.
create index if not exists api_request_logs_company_time_idx
  on public.api_request_logs(company_id, created_at desc);
create index if not exists api_request_logs_key_idx on public.api_request_logs(api_key_id);

-- --- Public webhook event catalogue -----------------------------------------
-- Platform-wide reference data (no company_id): every tenant sees the same list.
create table if not exists public.webhook_event_types (
  event       text primary key,
  label       text not null,
  description text not null default '',
  -- Example payload rendered in the docs and sent by "Send test event".
  sample_json jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

insert into public.webhook_event_types (event, label, description, sample_json) values
  ('lead.created', 'Lead created',
   'A visitor left their contact details through the assistant.',
   '{"id":"00000000-0000-0000-0000-000000000000","name":"Sample Lead","email":"lead@example.com","phone":null,"status":"new"}'::jsonb),
  ('appointment.created', 'Appointment requested',
   'A visitor asked for a booking or a callback.',
   '{"id":"00000000-0000-0000-0000-000000000000","customer_name":"Sample Customer","service_type":"Consultation","preferred_date":"2026-01-01"}'::jsonb),
  ('order.created', 'Order created',
   'An order was placed in chat or synced from a connected store.',
   '{"id":"00000000-0000-0000-0000-000000000000","total":49.99,"currency":"USD","status":"pending"}'::jsonb),
  ('ticket.created', 'Ticket created',
   'A conversation was escalated to a human agent.',
   '{"conversationId":"00000000-0000-0000-0000-000000000000","priority":"normal"}'::jsonb),
  ('ticket.resolved', 'Ticket resolved',
   'An agent marked an escalated conversation resolved.',
   '{"conversationId":"00000000-0000-0000-0000-000000000000","resolution":"Fixed"}'::jsonb),
  ('contact.created', 'Contact created via API',
   'A contact was created through POST /api/v1/contacts.',
   '{"id":"00000000-0000-0000-0000-000000000000","name":"Sample Contact","email":"contact@example.com","source":"api"}'::jsonb),
  ('message.sent', 'Message sent via API',
   'A message was delivered through POST /api/v1/messages.',
   '{"conversation_id":"00000000-0000-0000-0000-000000000000","channel":"whatsapp","text":"Hello from the API"}'::jsonb),
  ('broadcast.created', 'Broadcast created via API',
   'A broadcast was scheduled through POST /api/v1/broadcasts.',
   '{"id":"00000000-0000-0000-0000-000000000000","channel":"email","audience":"all_leads"}'::jsonb)
on conflict (event) do update
  set label = excluded.label,
      description = excluded.description,
      sample_json = excluded.sample_json;

-- RLS — members read their own company's keys and logs; every write goes
-- through the service-role client in guarded server actions / the API wrapper.
do $$
declare t text;
begin
  foreach t in array array['api_keys', 'api_request_logs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_super_admin_all', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin())', t || '_super_admin_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_members', t);
    execute format('create policy %I on public.%I for select to authenticated using (company_id in (select public.user_company_ids()))', t || '_select_members', t);
  end loop;
end $$;

-- The catalogue is shared reference data, so the member policy is "any signed-in
-- user" rather than a company match — there is no company_id to match on.
alter table public.webhook_event_types enable row level security;

drop policy if exists webhook_event_types_super_admin_all on public.webhook_event_types;
create policy webhook_event_types_super_admin_all on public.webhook_event_types
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists webhook_event_types_select_members on public.webhook_event_types;
create policy webhook_event_types_select_members on public.webhook_event_types
  for select to authenticated using (true);
