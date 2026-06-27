-- ===========================================================================
-- Migration 0012 — Voice-ready table (Module 22) + privacy/retention (Module 23)
-- ===========================================================================

-- Future voice transcripts (architecture prepared now; voice not built).
create table if not exists public.voice_transcripts_future (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  message_id      uuid references public.messages(id) on delete cascade,
  audio_url       text,
  transcript_text text,
  stt_provider    text,
  tts_provider    text,
  confidence_score numeric(5,4),
  created_at      timestamptz not null default now()
);
alter table public.voice_transcripts_future enable row level security;
drop policy if exists voice_transcripts_super_admin_all on public.voice_transcripts_future;
create policy voice_transcripts_super_admin_all on public.voice_transcripts_future
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

-- Super-admin raw chat-access log (Module 23: "super admin chat access is logged").
create table if not exists public.admin_access_logs (
  id            uuid primary key default gen_random_uuid(),
  super_admin_id uuid references public.users(id) on delete set null,
  company_id    uuid references public.companies(id) on delete set null,
  action        text not null,
  target_type   text,
  target_id     text,
  created_at    timestamptz not null default now()
);
alter table public.admin_access_logs enable row level security;
drop policy if exists admin_access_logs_super_admin_all on public.admin_access_logs;
create policy admin_access_logs_super_admin_all on public.admin_access_logs
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

-- Retention cleanup (Module 23: default 30-day chat auto-delete, configurable).
-- Deletes closed/old conversations (cascades messages) past each company's
-- retention window. Defaults to 30 days when no company setting exists.
create or replace function public.cleanup_old_chats()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted integer := 0;
  rc integer := 0;
  r record;
  retention_days integer;
begin
  for r in select id from public.companies loop
    select coalesce(
      (select (value_json #>> '{}')::int
         from public.company_settings
        where company_id = r.id and key = 'chat_retention_days'),
      30
    ) into retention_days;

    delete from public.conversations c
    where c.company_id = r.id
      and c.last_message_at < now() - (retention_days || ' days')::interval;

    get diagnostics rc = row_count;
    deleted := deleted + rc;
  end loop;
  return deleted;
end;
$$;
