-- ===========================================================================
-- Migration 0077 — Attachments: the project's first object storage
--
-- `messages.content_type` has permitted 'image' and 'file' since migration
-- 0005, but nothing could ever produce one: `storage.from` has zero hits in the
-- codebase and this database has no buckets at all. A customer with a broken
-- product could describe it and nothing more, which is the single most common
-- thing a support chat is asked to do.
--
-- Three things are created here.
--
--   1. A PRIVATE bucket, `chat-attachments`. Files a customer sends are tenant
--      data — an invoice, a passport photo, a screenshot with an order number
--      on it. A public bucket hands every one of those to anybody who can guess
--      or scrape an object path, so the bucket is private and every read goes
--      through a short-lived signed URL minted server-side.
--
--   2. Policies on `storage.objects` that keep one company's files out of
--      another's reach. Object names are laid out `<company_id>/<conversation_id>/<uuid>.<ext>`
--      precisely so the first path segment IS the tenant key and a policy can
--      test it.
--
--   3. `public.message_attachments`, one row per stored object, which is what
--      makes an attachment auditable, countable (the per-company quota) and
--      deletable later.
--
-- `public.messages` itself needs NO new column. Its `content_type` check
-- already allows 'image' and 'file', and `metadata_json` already exists — the
-- writer stamps `metadata_json.attachment` with `{id,name,mimeType,size,kind}`
-- so a reader that has already selected the message row can render the
-- attachment without a join, while `message_attachments.message_id` remains the
-- authoritative link. Both are written in one code path that deletes the
-- message again if the attachment row fails, so they cannot drift apart.
--
-- On bucket creation: `storage.create_bucket()` exists only on some versions of
-- the storage extension (it was dropped years ago), while `insert into
-- storage.buckets` works on every version that has ever shipped. Rather than
-- guess which one this Postgres has, the block below asks `pg_proc` and uses
-- whichever is actually present. Same reasoning for `file_size_limit` and
-- `allowed_mime_types`: they are checked in `information_schema.columns` before
-- being written, so an older storage schema still gets a working bucket instead
-- of a migration that aborts halfway through.
--
-- Those two bucket-level limits are a backstop, not the enforcement. The real
-- check happens in `src/lib/attachments/sniff.ts`, which reads the leading
-- bytes of the upload: `allowed_mime_types` compares the content type the
-- CLIENT claimed, and a client that wants to send an executable will happily
-- claim `image/png`.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The bucket
-- ---------------------------------------------------------------------------
do $$
declare
  has_create_bucket boolean;
begin
  if to_regclass('storage.buckets') is null then
    raise exception
      'storage.buckets does not exist — enable Supabase Storage on this project before applying 0077';
  end if;

  select exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'storage'
      and p.proname = 'create_bucket'
      and p.pronargs = 1
  ) into has_create_bucket;

  if not exists (select 1 from storage.buckets where id = 'chat-attachments') then
    if has_create_bucket then
      perform storage.create_bucket('chat-attachments');
    else
      insert into storage.buckets (id, name) values ('chat-attachments', 'chat-attachments');
    end if;
  end if;

  -- Private, unconditionally, including on a re-run. This is the one property
  -- that must never drift: flipping it to true would publish every customer
  -- file on the platform at a stable, guessable URL.
  update storage.buckets set public = false where id = 'chat-attachments';
end$$;

-- Bucket-level caps, written only if this storage version has the columns.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit'
  ) then
    -- 10 MiB, the same number as MAX_ATTACHMENT_BYTES in
    -- src/lib/attachments/policy.ts. Keep the two in step.
    update storage.buckets set file_size_limit = 10485760 where id = 'chat-attachments';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types'
  ) then
    update storage.buckets
      set allowed_mime_types = array[
        'image/png',
        'image/jpeg',
        'image/gif',
        'image/webp',
        'application/pdf',
        'text/plain'
      ]::text[]
      where id = 'chat-attachments';
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- 2. Object policies
--
-- Uploads and deletes are done by the server with the service-role key, which
-- bypasses RLS entirely, so there is deliberately no insert/update/delete
-- policy here: RLS default-denies, and that is the correct answer for anon and
-- authenticated alike. Nobody writes to this bucket except code that has
-- already established which company the request belongs to.
--
-- The select policy exists for the day somebody wires a signed-in browser
-- directly to storage. `split_part(...)` is compared as TEXT rather than cast
-- to uuid: a single stray object whose name did not start with a company id
-- would make the cast raise, and a raising policy fails the query for everyone.
-- ---------------------------------------------------------------------------
drop policy if exists chat_attachments_select_own_company on storage.objects;
create policy chat_attachments_select_own_company on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-attachments'
    and (
      public.is_super_admin()
      or exists (
        -- Through `user_company_ids()` rather than reading `company_users`
        -- directly: that table has RLS of its own, and the function is
        -- `security definer` precisely so a policy can ask it.
        select 1
        from public.user_company_ids() as cid
        where cid::text = split_part(name, '/', 1)
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 3. The attachment rows
-- ---------------------------------------------------------------------------
create table if not exists public.message_attachments (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  conversation_id     uuid not null references public.conversations(id) on delete cascade,
  message_id          uuid not null references public.messages(id) on delete cascade,
  storage_bucket      text not null default 'chat-attachments',
  storage_path        text not null,
  -- The name as the sender typed it, sanitised. Display only: it is never used
  -- to build the storage path and never used to decide the content type.
  file_name           text not null,
  -- The type SNIFFED from the bytes, not the one the client sent.
  mime_type           text not null,
  byte_size           bigint not null check (byte_size > 0),
  kind                text not null check (kind in ('image', 'file')),
  uploaded_by         text not null check (uploaded_by in ('visitor', 'agent')),
  uploaded_by_user_id uuid references public.users(id) on delete set null,
  visitor_id          text,
  created_at          timestamptz not null default now()
);

-- Plain unique index, not a partial one: migration 0070 recorded what happens
-- when a partial index is asked to serve an upsert, and a plain index also
-- keeps the "one row per object" guarantee readable.
create unique index if not exists uq_message_attachments_path
  on public.message_attachments(storage_path);
create index if not exists idx_message_attachments_conversation
  on public.message_attachments(company_id, conversation_id, created_at);
create index if not exists idx_message_attachments_message
  on public.message_attachments(message_id);
-- Backs the per-company quota sum below.
create index if not exists idx_message_attachments_company
  on public.message_attachments(company_id);

comment on table public.message_attachments is
  'One row per object in the chat-attachments bucket. storage_path is '
  '<company_id>/<conversation_id>/<uuid>.<ext>; the leading company_id is what '
  'the storage.objects policy checks, so it must never be rewritten.';

alter table public.message_attachments enable row level security;

drop policy if exists message_attachments_select_members on public.message_attachments;
create policy message_attachments_select_members on public.message_attachments
  for select to authenticated using (company_id in (select public.user_company_ids()));

drop policy if exists message_attachments_super_admin_all on public.message_attachments;
create policy message_attachments_super_admin_all on public.message_attachments
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 4. Per-company storage total
--
-- The upload path needs this before every write, so it is one aggregate in the
-- database rather than a page of rows pulled over PostgREST.
--
-- Guarded the way migration 0072 established, and NOT the way 0071 did: this
-- project uses Supabase's newer opaque `sb_secret_…` keys, so
-- `current_setting('request.jwt.claim.role', true)` is always null and a check
-- written that way refuses the server's own service-role call. `auth.uid()`
-- answers the question that actually matters — a null caller is the server,
-- which has already resolved the company; a non-null caller is a person, who
-- must be a member of the company they are asking about.
--
-- The real boundary is still the grant: execute belongs to service_role alone.
-- ---------------------------------------------------------------------------
create or replace function public.company_attachment_bytes(p_company_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  total  bigint;
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

  select coalesce(sum(byte_size), 0) into total
  from public.message_attachments
  where company_id = p_company_id;

  return total;
end;
$$;

revoke execute on function public.company_attachment_bytes(uuid) from public;
revoke execute on function public.company_attachment_bytes(uuid) from anon;
revoke execute on function public.company_attachment_bytes(uuid) from authenticated;
grant execute on function public.company_attachment_bytes(uuid) to service_role;
