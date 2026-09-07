-- ===========================================================================
-- Migration 0079 — REST hooks: subscriptions, an event outbox, and a kill switch
--
-- Zapier (and Make, and n8n) do not poll a well-built integration: they POST a
-- target URL to say "tell me when X happens", and DELETE it when the Zap is
-- turned off. That handshake is called a REST hook, and it is the whole reason
-- this product does not need native HubSpot / Salesforce / Pipedrive / Sheets
-- connectors — one Zapier app reaches all of them.
--
-- WHY A SUBSCRIPTION IS ALSO A WEBHOOK ENDPOINT
-- --------------------------------------------
-- Outbound delivery already exists and is good: `src/lib/webhooks.ts` signs the
-- body with HMAC-SHA256, retries once, meters deliveries against the plan and
-- writes `webhook_deliveries`. It finds its destinations by querying
-- `webhook_endpoints`. So a REST hook subscription IS an endpoint row — a third
-- `kind` alongside 'generic' and 'slack' — and every event the product already
-- fires reaches Zapier with no second delivery path, no second signing scheme
-- and no second delivery log. `rest_hook_subscriptions` holds only what the
-- endpoint row cannot: which integration created it, the hash that makes a
-- repeated subscribe idempotent, and why it was disabled.
--
-- The new kind deliberately is NOT 'generic'. `dispatchWebhookEvent` reports
-- back which endpoint kinds covered an event so the older
-- `company_notification_settings` channels can stand aside and not deliver the
-- same alert twice (migration 0051). A Zap must not silence a company's own
-- webhook or Slack channel, and with a kind of its own it cannot.
--
-- WHY AN OUTBOX, AND WHY ONLY THESE FOUR EVENTS
-- --------------------------------------------
-- The events the product fires through `notify()` carry a title and a sentence
-- of prose — enough for a Slack message, nowhere near enough for a Zap that has
-- to write an email address into a CRM. `notify({ type: 'new_lead' })` in
-- `src/lib/tools/leads.ts` passes no `data` at all. Worse, the fire points are
-- partial: an enquiry captured by the assistant fires `lead.created`, the same
-- enquiry created through `POST /api/v1/contacts` fires `contact.created`, and
-- an order synced from a store fires nothing.
--
-- So the four events worth automating on are raised from the tables themselves,
-- where every write path meets:
--
--   enquiry.created       a row in `leads`, however it was captured
--   conversation.created  a row in `conversations`
--   conversation.closed   a conversation whose status becomes 'closed'
--   order.placed          a row in `chat_orders`
--
-- Each carries the whole record, field for field with what `/api/v1` returns
-- for that object, so a Zap maps "Email" once and it keeps working.
--
-- The trigger cannot deliver — Postgres has no business making outbound HTTPS
-- calls, and doing so would be exactly the second delivery path this design
-- avoids. It writes to `rest_hook_events`, and `/api/v1/hooks/dispatch` drains
-- that through `dispatchWebhookEvent` on the schedule in `vercel.json`.
--
-- Three properties of the triggers matter more than the events themselves:
--
--   * Nothing is enqueued unless an active endpoint is already subscribed to
--     that event. A company with no Zaps pays one indexed EXISTS per insert and
--     the outbox stays empty.
--   * Every trigger body is wrapped in an exception handler. An integration
--     must never be able to stop a customer's enquiry, order or conversation
--     being saved; the worst a broken hook can cost is the hook.
--   * `chat_orders` only. `synced_orders` arrives in bulk from a store
--     connector — a first Shopify sync would fire a thousand Zaps in one
--     minute. Those stores have their own Zapier apps for that.
--
-- A DANGLING SUBSCRIPTION IS A REAL COST
-- --------------------------------------
-- When a Zap is deleted, Zapier stops answering its target URL. Nothing tells
-- us; the deliveries simply start failing, and every failure costs a request,
-- a retry, a row in the delivery log and a slice of the plan's budget forever.
-- `dispatchWebhookEvent` already counts consecutive failures on the endpoint
-- and resets the count on success, so the kill switch is a trigger on that
-- counter: five consecutive failures deactivates the endpoint and records why
-- on the subscription. It fires only for `kind = 'rest_hook'` — deciding on a
-- company's own endpoint's behalf that it should stop is not this migration's
-- business.
-- ===========================================================================

-- --- 1. `webhook_endpoints.kind` gains a third value ------------------------
-- A check constraint cannot be extended in place: it is dropped and re-added
-- with the existing values repeated verbatim. The name is looked up rather than
-- assumed, because an inline `check` gets whatever name Postgres chose.
do $$
declare
  constraint_name text;
begin
  select con.conname into constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace ns on ns.oid = rel.relnamespace
  where ns.nspname = 'public'
    and rel.relname = 'webhook_endpoints'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%kind%'
  limit 1;

  if constraint_name is not null then
    execute format('alter table public.webhook_endpoints drop constraint %I', constraint_name);
  end if;

  alter table public.webhook_endpoints
    add constraint webhook_endpoints_kind_check
    check (kind in ('generic', 'slack', 'rest_hook'));
end $$;

-- --- 2. Subscriptions -------------------------------------------------------
create table if not exists public.rest_hook_subscriptions (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  event              text not null,
  -- SHA-256 hex of the target URL. The URL itself is a bearer credential —
  -- anyone holding it can push into the customer's Zap — so the only copy kept
  -- is the encrypted one on the endpoint row. This hash exists so that a
  -- repeated subscribe finds the row it already created instead of piling up
  -- duplicates, which is what Zapier does whenever a Zap is edited and re-saved.
  target_url_hash    text not null,
  -- Enough of the URL to recognise it in the console. Never enough to call it.
  target_url_preview text not null default '',
  -- The delivery vehicle. ON DELETE CASCADE, so removing the endpoint from
  -- Company → Webhooks removes the subscription with it: one kill switch, and
  -- no row that claims to be subscribed to something that cannot be delivered.
  endpoint_id        uuid not null references public.webhook_endpoints(id) on delete cascade,
  -- Which key created it, for the audit trail. The key may be revoked later
  -- without invalidating a working Zap, so the reference is nullable.
  api_key_id         uuid references public.api_keys(id) on delete set null,
  client             text not null default 'zapier',
  label              text,
  disabled_at        timestamptz,
  disabled_reason    text,
  created_at         timestamptz not null default now()
);

-- Idempotency key for subscribe. A PLAIN unique index, not a partial one:
-- PostgREST's `on_conflict` cannot send a predicate, so a partial index can
-- never serve an upsert (migration 0070 learned this the hard way). Re-
-- subscribing therefore revives a disabled row rather than colliding with it.
create unique index if not exists rest_hook_subscriptions_target_key
  on public.rest_hook_subscriptions (company_id, event, target_url_hash);
create index if not exists rest_hook_subscriptions_company_idx
  on public.rest_hook_subscriptions (company_id, created_at desc);
create index if not exists rest_hook_subscriptions_endpoint_idx
  on public.rest_hook_subscriptions (endpoint_id);

-- --- 3. The outbox ----------------------------------------------------------
create table if not exists public.rest_hook_events (
  id           bigserial primary key,
  company_id   uuid not null references public.companies(id) on delete cascade,
  event        text not null,
  title        text not null default '',
  body         text,
  payload_json jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  -- Set when the dispatcher takes the row. Claiming BEFORE delivering makes
  -- this at-most-once: a process that dies mid-flight drops an event rather
  -- than replaying it, and a replayed event is a duplicate Zap run — a second
  -- invoice, a second CRM record — which is the worse of the two failures.
  claimed_at   timestamptz
);

-- The dispatcher's only query. Partial, because unclaimed rows are a tiny and
-- short-lived slice of the table; nothing upserts here, so the caveat that
-- rules partial indexes out elsewhere does not apply.
create index if not exists rest_hook_events_pending_idx
  on public.rest_hook_events (id) where claimed_at is null;
create index if not exists rest_hook_events_claimed_idx
  on public.rest_hook_events (claimed_at);

-- --- 4. Payload builders ----------------------------------------------------
-- One definition per object, used by BOTH the triggers that raise an event and
-- the sample function the Zap editor calls to show test data. Written once so
-- the two cannot drift: a sample whose field names differ from the real payload
-- silently breaks every field mapping in the Zap that was built from it.
--
-- Field names match `src/lib/api/serializers.ts` exactly, so the object in a
-- Zap step is the same object `/api/v1` returns.

create or replace function public.rest_hook_enquiry_payload(p public.leads)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'email', p.email,
    'phone', p.phone,
    'enquiry_type', p.enquiry_type,
    'message', p.message,
    'source', p.source,
    'source_page', p.source_page,
    'status', p.status,
    'conversation_id', p.conversation_id,
    'created_at', p.created_at
  );
$$;

create or replace function public.rest_hook_conversation_payload(p public.conversations)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', p.id,
    'channel', p.channel,
    'status', p.status,
    'language', p.language,
    'visitor_id', p.visitor_id,
    'customer_id', p.customer_id,
    'assigned_agent_id', p.assigned_agent_id,
    'ai_enabled', p.ai_enabled,
    'unread_count', p.unread_count,
    'started_at', p.started_at,
    'last_message_at', p.last_message_at,
    'closed_at', p.closed_at
  );
$$;

create or replace function public.rest_hook_order_payload(p public.chat_orders)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', p.id,
    'source', 'chat',
    'order_number', p.external_ref,
    'status', p.status,
    'order_type', p.order_type,
    'customer_name', p.customer_name,
    'customer_email', p.customer_email,
    'customer_phone', p.customer_phone,
    'total', p.total,
    'currency', p.currency,
    'conversation_id', p.conversation_id,
    'created_at', p.created_at
  );
$$;

revoke execute on function public.rest_hook_enquiry_payload(public.leads) from public, anon, authenticated;
revoke execute on function public.rest_hook_conversation_payload(public.conversations) from public, anon, authenticated;
revoke execute on function public.rest_hook_order_payload(public.chat_orders) from public, anon, authenticated;
grant execute on function public.rest_hook_enquiry_payload(public.leads) to service_role;
grant execute on function public.rest_hook_conversation_payload(public.conversations) to service_role;
grant execute on function public.rest_hook_order_payload(public.chat_orders) to service_role;

-- --- 5. Triggers that raise the four events ---------------------------------
-- All four are `security definer` so the insert into the outbox succeeds
-- whatever role wrote the row, and none of them may raise: the exception block
-- is the difference between "a Zap missed one event" and "a customer could not
-- send an enquiry". They are not revoked from anyone, because a trigger
-- function cannot be called usefully by hand — invoking one directly raises
-- "trigger functions can only be called as triggers" — while revoking EXECUTE
-- on a function a hot insert path depends on is a risk with nothing to buy.

create or replace function public.rest_hook_on_lead_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if exists (
      select 1 from public.webhook_endpoints w
      where w.company_id = new.company_id
        and w.active
        and w.events @> array['enquiry.created']
    ) then
      insert into public.rest_hook_events (company_id, event, title, body, payload_json)
      values (
        new.company_id,
        'enquiry.created',
        'New enquiry',
        coalesce(new.name, new.email, new.phone, 'Website visitor'),
        public.rest_hook_enquiry_payload(new)
      );
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$$;

create or replace function public.rest_hook_on_conversation_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if exists (
      select 1 from public.webhook_endpoints w
      where w.company_id = new.company_id
        and w.active
        and w.events @> array['conversation.created']
    ) then
      insert into public.rest_hook_events (company_id, event, title, body, payload_json)
      values (
        new.company_id,
        'conversation.created',
        'New conversation',
        format('A conversation started on %s.', new.channel),
        public.rest_hook_conversation_payload(new)
      );
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$$;

create or replace function public.rest_hook_on_conversation_closed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if exists (
      select 1 from public.webhook_endpoints w
      where w.company_id = new.company_id
        and w.active
        and w.events @> array['conversation.closed']
    ) then
      insert into public.rest_hook_events (company_id, event, title, body, payload_json)
      values (
        new.company_id,
        'conversation.closed',
        'Conversation closed',
        format('A conversation on %s was closed.', new.channel),
        public.rest_hook_conversation_payload(new)
      );
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$$;

create or replace function public.rest_hook_on_chat_order_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if exists (
      select 1 from public.webhook_endpoints w
      where w.company_id = new.company_id
        and w.active
        and w.events @> array['order.placed']
    ) then
      insert into public.rest_hook_events (company_id, event, title, body, payload_json)
      values (
        new.company_id,
        'order.placed',
        'New order',
        format('%s — %s %s', coalesce(new.customer_name, 'A customer'), new.total, new.currency),
        public.rest_hook_order_payload(new)
      );
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$$;

drop trigger if exists trg_rest_hook_lead_insert on public.leads;
create trigger trg_rest_hook_lead_insert
  after insert on public.leads
  for each row execute function public.rest_hook_on_lead_insert();

drop trigger if exists trg_rest_hook_conversation_insert on public.conversations;
create trigger trg_rest_hook_conversation_insert
  after insert on public.conversations
  for each row execute function public.rest_hook_on_conversation_insert();

-- `update of status` plus the WHEN clause means the function is not even
-- entered for the ordinary updates a conversation gets on every single message.
drop trigger if exists trg_rest_hook_conversation_closed on public.conversations;
create trigger trg_rest_hook_conversation_closed
  after update of status on public.conversations
  for each row
  when (new.status = 'closed' and old.status is distinct from 'closed')
  execute function public.rest_hook_on_conversation_closed();

drop trigger if exists trg_rest_hook_chat_order_insert on public.chat_orders;
create trigger trg_rest_hook_chat_order_insert
  after insert on public.chat_orders
  for each row execute function public.rest_hook_on_chat_order_insert();

-- --- 6. The kill switch -----------------------------------------------------
create or replace function public.rest_hook_disable_failing_endpoint()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    -- No recursion: this UPDATE does not touch `failure_count`, and the trigger
    -- below fires only on `update of failure_count`.
    update public.webhook_endpoints
      set active = false
      where id = new.id;

    update public.rest_hook_subscriptions
      set disabled_at = now(),
          disabled_reason = format(
            'Disabled automatically after %s consecutive delivery failures.',
            new.failure_count
          )
      where endpoint_id = new.id
        and disabled_at is null;
  exception when others then
    null;
  end;
  return null;
end;
$$;

drop trigger if exists trg_rest_hook_disable_failing on public.webhook_endpoints;
create trigger trg_rest_hook_disable_failing
  after update of failure_count on public.webhook_endpoints
  for each row
  when (new.kind = 'rest_hook' and new.active and new.failure_count >= 5)
  execute function public.rest_hook_disable_failing_endpoint();

-- --- 7. Sample data for the Zap editor --------------------------------------
-- Zapier will not let anyone finish building a Zap without seeing a real record
-- from their own account, and a REST hook has nothing to show until something
-- happens. This returns the last few real records for one event, shaped by the
-- same payload builders the triggers use.
--
-- `security definer` because it reads three tenant tables. The guard asks WHO
-- the caller is, not how they authenticated: this project's Supabase keys are
-- the opaque `sb_secret_…` format, not JWTs, so `current_setting('request.jwt.
-- claim.role')` is always null and a guard written that way refuses the
-- server's own call (migration 0072). A null `auth.uid()` is precisely the
-- server-side service-role case; a real user must be a member of the company
-- they are asking about.
create or replace function public.rest_hook_samples(
  p_company_id uuid,
  p_event text,
  p_limit integer default 3
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  lim integer := least(greatest(coalesce(p_limit, 3), 1), 25);
  result jsonb;
begin
  if caller is not null
     and not exists (
       select 1 from public.company_users cu
       where cu.company_id = p_company_id
         and cu.user_id = caller
     )
     and not public.is_super_admin()
  then
    raise exception 'not permitted for this company';
  end if;

  if p_event = 'enquiry.created' then
    select coalesce(jsonb_agg(s.payload order by s.created_at desc), '[]'::jsonb)
      into result
      from (
        select public.rest_hook_enquiry_payload(l) as payload, l.created_at
        from public.leads l
        where l.company_id = p_company_id
        order by l.created_at desc
        limit lim
      ) s;

  elsif p_event = 'conversation.created' then
    select coalesce(jsonb_agg(s.payload order by s.created_at desc), '[]'::jsonb)
      into result
      from (
        select public.rest_hook_conversation_payload(c) as payload, c.started_at as created_at
        from public.conversations c
        where c.company_id = p_company_id
        order by c.started_at desc
        limit lim
      ) s;

  elsif p_event = 'conversation.closed' then
    select coalesce(jsonb_agg(s.payload order by s.created_at desc), '[]'::jsonb)
      into result
      from (
        select public.rest_hook_conversation_payload(c) as payload,
               coalesce(c.closed_at, c.last_message_at) as created_at
        from public.conversations c
        where c.company_id = p_company_id
          and c.status = 'closed'
        order by coalesce(c.closed_at, c.last_message_at) desc
        limit lim
      ) s;

  elsif p_event = 'order.placed' then
    select coalesce(jsonb_agg(s.payload order by s.created_at desc), '[]'::jsonb)
      into result
      from (
        select public.rest_hook_order_payload(o) as payload, o.created_at
        from public.chat_orders o
        where o.company_id = p_company_id
        order by o.created_at desc
        limit lim
      ) s;
  end if;

  return coalesce(result, '[]'::jsonb);
end;
$$;

revoke execute on function public.rest_hook_samples(uuid, text, integer) from public;
revoke execute on function public.rest_hook_samples(uuid, text, integer) from anon;
revoke execute on function public.rest_hook_samples(uuid, text, integer) from authenticated;
grant execute on function public.rest_hook_samples(uuid, text, integer) to service_role;

-- --- 8. The four events join the public catalogue ---------------------------
-- Adding them here is what makes them selectable on Company → Webhooks too: a
-- company that would rather receive the richer payload on its own endpoint can,
-- without going near Zapier.
insert into public.webhook_event_types (event, label, description, sample_json) values
  ('enquiry.created', 'New enquiry (full record)',
   'Someone left their details — whatever captured them, with the whole enquiry attached. Prefer this over lead.created for automations.',
   '{"id":"00000000-0000-0000-0000-000000000000","name":"Sample Person","email":"person@example.com","phone":null,"enquiry_type":"Quote","message":"Do you deliver on Saturdays?","source":"chat","source_page":"/pricing","status":"new","conversation_id":null,"created_at":"2026-01-01T09:00:00Z"}'::jsonb),
  ('conversation.created', 'New conversation',
   'A customer started a conversation on any channel.',
   '{"id":"00000000-0000-0000-0000-000000000000","channel":"web_chat","status":"ai_active","language":"en","visitor_id":"visitor_123","customer_id":null,"assigned_agent_id":null,"ai_enabled":true,"unread_count":1,"started_at":"2026-01-01T09:00:00Z","last_message_at":"2026-01-01T09:00:00Z","closed_at":null}'::jsonb),
  ('conversation.closed', 'Conversation closed',
   'A conversation was closed, by an agent or by the assistant.',
   '{"id":"00000000-0000-0000-0000-000000000000","channel":"web_chat","status":"closed","language":"en","visitor_id":"visitor_123","customer_id":null,"assigned_agent_id":null,"ai_enabled":false,"unread_count":0,"started_at":"2026-01-01T09:00:00Z","last_message_at":"2026-01-01T09:20:00Z","closed_at":"2026-01-01T09:21:00Z"}'::jsonb),
  ('order.placed', 'New order (full record)',
   'An order was placed in a conversation, with the whole order attached. Orders mirrored from a connected store do not fire this.',
   '{"id":"00000000-0000-0000-0000-000000000000","source":"chat","order_number":null,"status":"pending","order_type":"internal","customer_name":"Sample Customer","customer_email":"customer@example.com","customer_phone":null,"total":49.99,"currency":"USD","conversation_id":null,"created_at":"2026-01-01T09:00:00Z"}'::jsonb)
on conflict (event) do update
  set label = excluded.label,
      description = excluded.description,
      sample_json = excluded.sample_json;

-- --- 9. RLS -----------------------------------------------------------------
-- Same shape as every other tenant table: members read their own company's
-- rows, super admins read everything, and every write goes through the
-- service-role client in a guarded API route.
do $$
declare t text;
begin
  foreach t in array array['rest_hook_subscriptions', 'rest_hook_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_super_admin_all', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin())', t || '_super_admin_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_members', t);
    execute format('create policy %I on public.%I for select to authenticated using (company_id in (select public.user_company_ids()))', t || '_select_members', t);
  end loop;
end $$;
