-- ===========================================================================
-- Migration 0076 — Contacts: the person underneath the enquiries
--
-- WHY THIS EXISTS
-- The product says "customers" but has never had a record of one. What it has
-- is `leads` (an enquiry), `synced_customers` (a row a shop's API handed us),
-- `appointments`, `chat_orders`, `synced_orders` and `conversations` — six
-- tables that each describe an EVENT. The same human who emailed in March,
-- messaged WhatsApp in June and filled a form last week is three unrelated
-- rows, so the assistant and the agent both meet them as a stranger every time.
--
-- This adds the missing noun. `contacts` is a person; `contact_identities`
-- holds the addresses that identify them; every event table gains a NULLABLE
-- `contact_id` pointing at the person it belongs to. Nothing existing is
-- renamed, retyped or dropped: the six tables have live rows and every reader
-- of them keeps working untouched, which is the whole reason the link is a new
-- nullable column and not a restructure.
--
-- HOW A ROW FINDS ITS PERSON
-- Same email, or same normalised phone, inside one company, is one person.
-- Never across companies — `company_id` is on the contact, on the identity, on
-- the unique index and in every function argument.
--
-- The linking is done by TRIGGERS rather than by application code. Enquiries
-- are written from a dozen places (the pre-chat form, the assistant's save-lead
-- tool, the public API, the flow engine, a CSV import, the shop sync, the
-- manual form on /company/leads), and a rule enforced in one of those places is
-- a rule that is wrong in the other eleven. In the database it holds for all of
-- them, including the ones written after this migration.
--
-- A resolution failure must never cost the business an enquiry, so the attach
-- trigger swallows its own errors and leaves `contact_id` null. A customer who
-- could not be filed is a bad day; a customer whose message was rejected
-- because we could not file them is a lost sale.
--
-- SAFE TO RUN TWICE. Every object is `if not exists` / `or replace`, and the
-- backfill only touches rows whose `contact_id` is still null.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Normalisation.
--
-- The phone rule is deliberately IDENTICAL to `toE164` in
-- src/lib/channels/sms.ts — strip everything that is not a digit and prefix
-- `+` — because the SMS and WhatsApp channels already store `external_id` that
-- way and a second, cleverer rule here would put the same person under two
-- keys. It means a number written nationally ("07700 900123") does not match
-- the same number written internationally ("+44 7700 900123"); that is a real
-- limit of the existing helper, shared here on purpose rather than forked.
-- ---------------------------------------------------------------------------
create or replace function public.contact_normalize_phone(p_value text)
returns text language sql immutable as $$
  select case
    when nullif(regexp_replace(coalesce(p_value, ''), '[^0-9]', '', 'g'), '') is null then null
    else '+' || regexp_replace(coalesce(p_value, ''), '[^0-9]', '', 'g')
  end;
$$;

create or replace function public.contact_normalize_email(p_value text)
returns text language sql immutable as $$
  select case
    when position('@' in lower(btrim(coalesce(p_value, '')))) > 1
      then lower(btrim(coalesce(p_value, '')))
    else null
  end;
$$;

-- ---------------------------------------------------------------------------
-- The person.
--
-- `emails` / `phones` are the readable copy an agent sees and the list page
-- searches; `contact_identities` below is what actually enforces "one address,
-- one person". Both are written by the same three functions, so they cannot
-- drift apart.
-- ---------------------------------------------------------------------------
create table if not exists public.contacts (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  display_name    text,
  emails          text[] not null default '{}',
  phones          text[] not null default '{}',
  -- Free-form. Anything a company wants to remember about a person that this
  -- schema has no column for: "prefers Arabic", "account number", "allergic to
  -- nuts". Agents add these one key at a time from the contact page.
  attributes_json jsonb  not null default '{}'::jsonb,
  tags            text[] not null default '{}',
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Name + every address, lowercased, in one column so the list page searches
  -- with a single `ilike` instead of an `or` across three columns and two
  -- arrays. Maintained by a trigger rather than declared `generated always as`
  -- because `array_to_string` is STABLE, not IMMUTABLE, and a generated column
  -- may only use immutable expressions.
  searchable      text not null default ''
);

create index if not exists idx_contacts_company on public.contacts (company_id, last_seen_at desc);

-- Trigram index for the "%name or address%" search on the list page.
--
-- `gin_trgm_ops` is looked up rather than named directly: migration 0001 asks
-- for pg_trgm without a schema, and Supabase may already have installed it into
-- `extensions`, which is not on this connection's search_path — an unqualified
-- reference would then fail the whole migration over an index. Without the
-- extension the search still works, on a sequential scan.
do $$
declare
  v_schema text;
begin
  select n.nspname into v_schema
    from pg_opclass oc
    join pg_namespace n on n.oid = oc.opcnamespace
    join pg_am am on am.oid = oc.opcmethod
    where oc.opcname = 'gin_trgm_ops' and am.amname = 'gin'
    limit 1;

  if v_schema is not null then
    execute format(
      'create index if not exists idx_contacts_search on public.contacts using gin (searchable %I.gin_trgm_ops)',
      v_schema);
  else
    execute 'create index if not exists idx_contacts_search on public.contacts (company_id, searchable text_pattern_ops)';
  end if;
end;
$$;

create or replace function public.contacts_before_write()
returns trigger language plpgsql as $$
begin
  new.searchable := lower(
    coalesce(new.display_name, '') || ' ' ||
    coalesce(array_to_string(new.emails, ' '), '') || ' ' ||
    coalesce(array_to_string(new.phones, ' '), '')
  );
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_contacts_before_write on public.contacts;
create trigger trg_contacts_before_write
  before insert or update on public.contacts
  for each row execute function public.contacts_before_write();

-- ---------------------------------------------------------------------------
-- The addresses that identify a person.
--
-- The unique index is PLAIN, not partial. A partial unique index cannot serve
-- `on conflict` unless the statement repeats the predicate, and `contact_resolve`
-- relies on `on conflict (company_id, kind, value)` to settle a race between two
-- messages from the same person arriving at once. `value` is `not null` anyway,
-- so a predicate would buy nothing (see migration 0064 for the same reasoning).
-- ---------------------------------------------------------------------------
create table if not exists public.contact_identities (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  kind       text not null check (kind in ('email', 'phone')),
  value      text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_contact_identities_value
  on public.contact_identities (company_id, kind, value);
create index if not exists idx_contact_identities_contact
  on public.contact_identities (contact_id);

-- ---------------------------------------------------------------------------
-- What an agent remembers about them that no event records.
-- ---------------------------------------------------------------------------
create table if not exists public.contact_notes (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  author_id  uuid references public.users(id) on delete set null,
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_contact_notes_contact
  on public.contact_notes (company_id, contact_id, created_at desc);

-- ---------------------------------------------------------------------------
-- The link, on everything that already exists.
--
-- Nullable, `on delete set null`, no default: an existing row is unchanged
-- until the backfill reaches it, and every current reader of these tables sees
-- exactly the columns it saw yesterday.
-- ---------------------------------------------------------------------------
alter table public.leads
  add column if not exists contact_id uuid references public.contacts(id) on delete set null;
alter table public.conversations
  add column if not exists contact_id uuid references public.contacts(id) on delete set null;
alter table public.synced_customers
  add column if not exists contact_id uuid references public.contacts(id) on delete set null;
-- Appointments and orders are linked too. The contact page has to be able to
-- answer "what has this person booked and bought", and matching those tables by
-- email at read time would miss every row whose phone is punctuated differently
-- from the one on the contact.
alter table public.appointments
  add column if not exists contact_id uuid references public.contacts(id) on delete set null;
alter table public.chat_orders
  add column if not exists contact_id uuid references public.contacts(id) on delete set null;
alter table public.synced_orders
  add column if not exists contact_id uuid references public.contacts(id) on delete set null;

create index if not exists idx_leads_contact            on public.leads (company_id, contact_id);
create index if not exists idx_conversations_contact    on public.conversations (company_id, contact_id);
create index if not exists idx_synced_customers_contact on public.synced_customers (company_id, contact_id);
create index if not exists idx_appointments_contact     on public.appointments (company_id, contact_id);
create index if not exists idx_chat_orders_contact      on public.chat_orders (company_id, contact_id);
create index if not exists idx_synced_orders_contact    on public.synced_orders (company_id, contact_id);
-- Threading a returning visitor's new chat onto the person they already are.
create index if not exists idx_conversations_visitor    on public.conversations (company_id, visitor_id);

-- ---------------------------------------------------------------------------
-- Caller guard, shared by every function below.
--
-- This project uses Supabase's NEW API keys (`sb_secret_…`), which are OPAQUE
-- keys and not JWTs, so `current_setting('request.jwt.claim.role', true)` is
-- always null and a guard written that way refuses the server's own
-- service-role call — that shipped once and broke a page (see migration 0072).
-- So the question asked here is WHO, not HOW: `auth.uid()` is null when there
-- is no end-user token, which is the server itself, and carries a user id when
-- a person is calling, who then has to be a member of the company they named.
--
-- The real boundary is the grant at the bottom of this file: execute is revoked
-- from public/anon/authenticated and given to service_role alone.
-- ---------------------------------------------------------------------------
create or replace function public.contact_assert_caller(p_company_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is not null
     and not exists (
       select 1 from public.company_users cu
       where cu.company_id = p_company_id and cu.user_id = caller
     )
     and not public.is_super_admin()
  then
    raise exception 'not permitted for this company';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fold one contact into another.
--
-- Reached when an enquiry arrives carrying an email we know belongs to person A
-- and a phone we know belongs to person B: they were never two people, we just
-- had not seen the two halves together before. Everything pointing at the
-- source is repointed at the target, the target keeps whatever it already had
-- and gains whatever it did not, and the source row goes.
-- ---------------------------------------------------------------------------
create or replace function public.contact_merge(p_company_id uuid, p_target uuid, p_source uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_target is null or p_source is null or p_target = p_source then
    return p_target;
  end if;

  update public.contact_identities set contact_id = p_target
    where company_id = p_company_id and contact_id = p_source;
  update public.contact_notes set contact_id = p_target
    where company_id = p_company_id and contact_id = p_source;
  update public.leads set contact_id = p_target
    where company_id = p_company_id and contact_id = p_source;
  update public.conversations set contact_id = p_target
    where company_id = p_company_id and contact_id = p_source;
  update public.synced_customers set contact_id = p_target
    where company_id = p_company_id and contact_id = p_source;
  update public.appointments set contact_id = p_target
    where company_id = p_company_id and contact_id = p_source;
  update public.chat_orders set contact_id = p_target
    where company_id = p_company_id and contact_id = p_source;
  update public.synced_orders set contact_id = p_target
    where company_id = p_company_id and contact_id = p_source;

  -- The target's own values win on every conflict, because the target is the
  -- record a person has been looking at and editing.
  update public.contacts t set
    display_name    = coalesce(nullif(btrim(t.display_name), ''), s.display_name),
    emails          = (select coalesce(array_agg(distinct v), '{}'::text[])
                         from unnest(t.emails || s.emails) v where v is not null),
    phones          = (select coalesce(array_agg(distinct v), '{}'::text[])
                         from unnest(t.phones || s.phones) v where v is not null),
    tags            = (select coalesce(array_agg(distinct v), '{}'::text[])
                         from unnest(t.tags || s.tags) v where v is not null),
    attributes_json = s.attributes_json || t.attributes_json,
    first_seen_at   = least(t.first_seen_at, s.first_seen_at),
    last_seen_at    = greatest(t.last_seen_at, s.last_seen_at)
  from public.contacts s
  where t.id = p_target and s.id = p_source
    and t.company_id = p_company_id and s.company_id = p_company_id;

  delete from public.contacts where id = p_source and company_id = p_company_id;
  return p_target;
end;
$$;

-- ---------------------------------------------------------------------------
-- Identity resolution. Given what an event knows about a human, return the
-- person — finding them, merging them or creating them as required.
--
-- Returns null when the event carries neither an email nor a phone. A name on
-- its own is not an identity: two enquiries from "John" are not evidence of one
-- John, and filing them together would put one customer's history in front of
-- another customer's name.
-- ---------------------------------------------------------------------------
create or replace function public.contact_resolve(
  p_company_id uuid,
  p_name       text default null,
  p_email      text default null,
  p_phone      text default null,
  p_seen_at    timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email    text        := public.contact_normalize_email(p_email);
  v_phone    text        := public.contact_normalize_phone(p_phone);
  v_name     text        := nullif(btrim(coalesce(p_name, '')), '');
  v_seen     timestamptz := coalesce(p_seen_at, now());
  v_by_email uuid;
  v_by_phone uuid;
  v_id       uuid;
begin
  if p_company_id is null then return null; end if;
  perform public.contact_assert_caller(p_company_id);
  if v_email is null and v_phone is null then return null; end if;

  -- Two messages from the same person can land in the same second — a
  -- pre-chat form and the assistant's save-lead tool routinely do. Locking the
  -- ADDRESS rather than the table serialises exactly the pair that would
  -- otherwise both decide "no such contact" and both insert one, and blocks
  -- nothing else in the system. Always email before phone, so two sessions
  -- holding one each can never deadlock on the other.
  if v_email is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || '|email|' || v_email, 0::bigint));
  end if;
  if v_phone is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || '|phone|' || v_phone, 0::bigint));
  end if;

  if v_email is not null then
    select ci.contact_id into v_by_email from public.contact_identities ci
      where ci.company_id = p_company_id and ci.kind = 'email' and ci.value = v_email;
  end if;
  if v_phone is not null then
    select ci.contact_id into v_by_phone from public.contact_identities ci
      where ci.company_id = p_company_id and ci.kind = 'phone' and ci.value = v_phone;
  end if;

  if v_by_email is not null and v_by_phone is not null and v_by_email <> v_by_phone then
    v_id := public.contact_merge(p_company_id, v_by_email, v_by_phone);
  else
    v_id := coalesce(v_by_email, v_by_phone);
  end if;

  if v_id is null then
    insert into public.contacts (company_id, display_name, emails, phones, first_seen_at, last_seen_at)
    values (
      p_company_id,
      v_name,
      case when v_email is null then '{}'::text[] else array[v_email] end,
      case when v_phone is null then '{}'::text[] else array[v_phone] end,
      v_seen,
      v_seen
    )
    returning id into v_id;
  else
    -- Never overwrite a name a person already has: an agent may have corrected
    -- it, and the shop's API may well be calling them "guest".
    update public.contacts c set
      display_name  = coalesce(nullif(btrim(c.display_name), ''), v_name),
      emails        = case when v_email is null or c.emails @> array[v_email]
                        then c.emails else c.emails || v_email end,
      phones        = case when v_phone is null or c.phones @> array[v_phone]
                        then c.phones else c.phones || v_phone end,
      first_seen_at = least(c.first_seen_at, v_seen),
      last_seen_at  = greatest(c.last_seen_at, v_seen)
    where c.id = v_id and c.company_id = p_company_id;
  end if;

  if v_email is not null then
    insert into public.contact_identities (company_id, contact_id, kind, value)
    values (p_company_id, v_id, 'email', v_email)
    on conflict (company_id, kind, value) do update set contact_id = excluded.contact_id;
  end if;
  if v_phone is not null then
    insert into public.contact_identities (company_id, contact_id, kind, value)
    values (p_company_id, v_id, 'phone', v_phone)
    on conflict (company_id, kind, value) do update set contact_id = excluded.contact_id;
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- An agent adding an address by hand.
--
-- If the address already belongs to somebody else, that is not an error to
-- refuse — it is the discovery that the two records are one human — so the two
-- are folded together and the record the agent was looking at survives.
-- ---------------------------------------------------------------------------
create or replace function public.contact_add_identity(
  p_company_id uuid,
  p_contact_id uuid,
  p_kind       text,
  p_value      text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_value text;
  v_owner uuid;
begin
  perform public.contact_assert_caller(p_company_id);

  if p_kind = 'email' then
    v_value := public.contact_normalize_email(p_value);
  elsif p_kind = 'phone' then
    v_value := public.contact_normalize_phone(p_value);
  else
    raise exception 'unknown identity kind %', p_kind;
  end if;
  if v_value is null then
    raise exception 'that is not a usable %', p_kind;
  end if;

  if not exists (
    select 1 from public.contacts c where c.id = p_contact_id and c.company_id = p_company_id
  ) then
    raise exception 'no such contact';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || '|' || p_kind || '|' || v_value, 0::bigint));

  select ci.contact_id into v_owner from public.contact_identities ci
    where ci.company_id = p_company_id and ci.kind = p_kind and ci.value = v_value;

  if v_owner is null then
    insert into public.contact_identities (company_id, contact_id, kind, value)
    values (p_company_id, p_contact_id, p_kind, v_value);
  elsif v_owner <> p_contact_id then
    perform public.contact_merge(p_company_id, p_contact_id, v_owner);
  end if;

  update public.contacts c set
    emails = case when p_kind = 'email' and not (c.emails @> array[v_value])
               then c.emails || v_value else c.emails end,
    phones = case when p_kind = 'phone' and not (c.phones @> array[v_value])
               then c.phones || v_value else c.phones end
  where c.id = p_contact_id and c.company_id = p_company_id;

  return p_contact_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- The triggers that keep everything attached from here on.
--
-- One generic function serves all five event tables; the three columns that
-- carry the identity are named per table in the CREATE TRIGGER arguments,
-- because `leads` calls them name/email/phone and `appointments` calls them
-- customer_name/customer_email/customer_phone.
-- ---------------------------------------------------------------------------
create or replace function public.contact_attach()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rec  jsonb := to_jsonb(new);
  v_id uuid;
begin
  -- Already filed, by an earlier write or by the backfill. Nothing to redo, and
  -- an agent who moved a row to a different person must not have it moved back.
  if (rec ->> 'contact_id') is not null then
    return new;
  end if;

  begin
    v_id := public.contact_resolve(
      (rec ->> 'company_id')::uuid,
      nullif(rec ->> tg_argv[0], ''),
      nullif(rec ->> tg_argv[1], ''),
      nullif(rec ->> tg_argv[2], ''),
      nullif(rec ->> 'created_at', '')::timestamptz
    );
  exception when others then
    -- Deliberately swallowed. This trigger sits in front of the pre-chat form,
    -- the assistant's lead tool, the public API and the shop sync; whatever
    -- goes wrong in here, the enquiry itself still has to be saved.
    v_id := null;
  end;

  if v_id is not null then
    new.contact_id := v_id;
  end if;
  return new;
end;
$$;

-- The chat an enquiry came out of belongs to the same person as the enquiry.
create or replace function public.contact_link_conversation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.contact_id is not null and new.conversation_id is not null then
    update public.conversations c
      set contact_id = new.contact_id
      where c.id = new.conversation_id
        and c.company_id = new.company_id
        and c.contact_id is null;
  end if;
  return null;
end;
$$;

-- A returning visitor from a host app that signed their identity is provably
-- the same person, so their next chat threads onto the contact without waiting
-- for them to type their email again. Only the `app:` form qualifies: a plain
-- widget visitor id is a per-browser cookie, and a shared computer would put
-- one customer's messages on another customer's page.
create or replace function public.contact_thread_conversation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if new.contact_id is null and new.visitor_id like 'app:%' then
    select c.contact_id into v_id
      from public.conversations c
      where c.company_id = new.company_id
        and c.visitor_id = new.visitor_id
        and c.contact_id is not null
      order by c.started_at desc
      limit 1;
    if v_id is not null then
      new.contact_id := v_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_leads_contact_attach on public.leads;
create trigger trg_leads_contact_attach
  before insert or update on public.leads
  for each row execute function public.contact_attach('name', 'email', 'phone');

drop trigger if exists trg_synced_customers_contact_attach on public.synced_customers;
create trigger trg_synced_customers_contact_attach
  before insert or update on public.synced_customers
  for each row execute function public.contact_attach('name', 'email', 'phone');

drop trigger if exists trg_appointments_contact_attach on public.appointments;
create trigger trg_appointments_contact_attach
  before insert or update on public.appointments
  for each row execute function public.contact_attach('customer_name', 'customer_email', 'customer_phone');

drop trigger if exists trg_chat_orders_contact_attach on public.chat_orders;
create trigger trg_chat_orders_contact_attach
  before insert or update on public.chat_orders
  for each row execute function public.contact_attach('customer_name', 'customer_email', 'customer_phone');

drop trigger if exists trg_synced_orders_contact_attach on public.synced_orders;
create trigger trg_synced_orders_contact_attach
  before insert or update on public.synced_orders
  for each row execute function public.contact_attach('customer_name', 'customer_email', 'customer_phone');

drop trigger if exists trg_leads_link_conversation on public.leads;
create trigger trg_leads_link_conversation
  after insert or update on public.leads
  for each row execute function public.contact_link_conversation();

drop trigger if exists trg_appointments_link_conversation on public.appointments;
create trigger trg_appointments_link_conversation
  after insert or update on public.appointments
  for each row execute function public.contact_link_conversation();

drop trigger if exists trg_chat_orders_link_conversation on public.chat_orders;
create trigger trg_chat_orders_link_conversation
  after insert or update on public.chat_orders
  for each row execute function public.contact_link_conversation();

drop trigger if exists trg_conversations_contact_thread on public.conversations;
create trigger trg_conversations_contact_thread
  before insert on public.conversations
  for each row execute function public.contact_thread_conversation();

-- ---------------------------------------------------------------------------
-- The list page's numbers, in one round trip.
--
-- The app server and its Postgres are in different places and a round trip
-- costs ~229 ms whatever it asks for, so five head-only counts is five times
-- the latency of one function that returns five numbers.
-- ---------------------------------------------------------------------------
create or replace function public.company_contact_counts(p_company_id uuid)
returns table (
  people                 integer,
  enquiries              integer,
  bookings               integer,
  orders                 integer,
  unidentified_enquiries integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.contact_assert_caller(p_company_id);
  return query
  select
    (select count(*)::integer from public.contacts     x where x.company_id = p_company_id),
    (select count(*)::integer from public.leads        x where x.company_id = p_company_id),
    (select count(*)::integer from public.appointments x where x.company_id = p_company_id),
    (select count(*)::integer from public.chat_orders  x where x.company_id = p_company_id)
      + (select count(*)::integer from public.synced_orders x where x.company_id = p_company_id),
    -- Enquiries that left no email and no phone. They are real work sitting in
    -- the enquiries list, and a Customers page that silently omitted them would
    -- read as "we have fewer customers than we do".
    (select count(*)::integer from public.leads x
      where x.company_id = p_company_id and x.contact_id is null);
end;
$$;

-- ---------------------------------------------------------------------------
-- Backfill.
--
-- One pass over every event table that carries a name/email/phone, oldest event
-- first, so the earliest sighting is the one that names the person and sets
-- their `first_seen_at`. `contact_resolve` does the grouping, which means the
-- backfill and every future write agree by construction.
--
-- Idempotent twice over: only rows with a null `contact_id` are considered, and
-- `contact_resolve` returns the EXISTING person for an address it has already
-- seen. Running this block a second time changes nothing.
-- ---------------------------------------------------------------------------
do $$
declare
  r         record;
  v_contact uuid;
begin
  for r in
    select 'leads'::text as src, l.id, l.company_id,
           l.name as nm, l.email as em, l.phone as ph, l.created_at as seen_at
      from public.leads l where l.contact_id is null
    union all
    select 'synced_customers', c.id, c.company_id,
           c.name, c.email, c.phone, c.created_at
      from public.synced_customers c where c.contact_id is null
    union all
    select 'appointments', a.id, a.company_id,
           a.customer_name, a.customer_email, a.customer_phone, a.created_at
      from public.appointments a where a.contact_id is null
    union all
    select 'chat_orders', o.id, o.company_id,
           o.customer_name, o.customer_email, o.customer_phone, o.created_at
      from public.chat_orders o where o.contact_id is null
    union all
    select 'synced_orders', o.id, o.company_id,
           o.customer_name, o.customer_email, o.customer_phone,
           coalesce(o.placed_at, o.created_at)
      from public.synced_orders o where o.contact_id is null
    order by seen_at, id
  loop
    v_contact := public.contact_resolve(r.company_id, r.nm, r.em, r.ph, r.seen_at);
    -- Null means the row named nobody we could recognise again. It keeps a null
    -- contact_id and stays exactly where it is, in its own list.
    continue when v_contact is null;

    case r.src
      when 'leads' then
        update public.leads set contact_id = v_contact where id = r.id;
      when 'synced_customers' then
        update public.synced_customers set contact_id = v_contact where id = r.id;
      when 'appointments' then
        update public.appointments set contact_id = v_contact where id = r.id;
      when 'chat_orders' then
        update public.chat_orders set contact_id = v_contact where id = r.id;
      when 'synced_orders' then
        update public.synced_orders set contact_id = v_contact where id = r.id;
      else
        null;
    end case;
  end loop;
end;
$$;

-- Conversations inherit the person from whatever came out of them. Written
-- set-based and guarded by `contact_id is null`, so it is safe to repeat and
-- never overwrites a link the triggers or an agent already made.
update public.conversations c
  set contact_id = l.contact_id
  from public.leads l
  where l.conversation_id = c.id
    and l.company_id = c.company_id
    and l.contact_id is not null
    and c.contact_id is null;

update public.conversations c
  set contact_id = a.contact_id
  from public.appointments a
  where a.conversation_id = c.id
    and a.company_id = c.company_id
    and a.contact_id is not null
    and c.contact_id is null;

update public.conversations c
  set contact_id = o.contact_id
  from public.chat_orders o
  where o.conversation_id = c.id
    and o.company_id = c.company_id
    and o.contact_id is not null
    and c.contact_id is null;

-- And a signed-in app user's other chats, on the same rule the insert trigger
-- applies going forward.
update public.conversations c
  set contact_id = known.contact_id
  from (
    select distinct on (company_id, visitor_id) company_id, visitor_id, contact_id
      from public.conversations
      where contact_id is not null and visitor_id like 'app:%'
      order by company_id, visitor_id, started_at desc
  ) known
  where c.company_id = known.company_id
    and c.visitor_id = known.visitor_id
    and c.contact_id is null;

-- ---------------------------------------------------------------------------
-- RLS, matching every other tenant table: members read their own company's
-- rows, super admins read everything, and all writes go through the
-- service-role client inside a guarded server action.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['contacts', 'contact_identities', 'contact_notes'] loop
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
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants. This is where the security actually lives: these functions take a
-- company id as an argument, so nobody but the server may call them.
-- (The trigger functions are not listed — Postgres checks EXECUTE on a trigger
-- function when the trigger is created, not each time it fires, and calling one
-- directly errors out as "may only be called as a trigger".)
-- ---------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.contact_assert_caller(uuid)',
    'public.contact_resolve(uuid, text, text, text, timestamptz)',
    'public.contact_merge(uuid, uuid, uuid)',
    'public.contact_add_identity(uuid, uuid, text, text)',
    'public.company_contact_counts(uuid)'
  ] loop
    execute format('revoke execute on function %s from public', fn);
    execute format('revoke execute on function %s from anon', fn);
    execute format('revoke execute on function %s from authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;
