-- ===========================================================================
-- Migration 0005 — Channel-agnostic conversation engine (Module 7)
-- conversations + messages, designed so web chat today and voice/WhatsApp later
-- reuse the same tables (Module 22). Realtime enabled for the inbox (Module 11).
-- ===========================================================================

create table if not exists public.conversations (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  bot_id            uuid references public.bots(id) on delete set null,
  channel           text not null default 'web_chat'
                      check (channel in ('web_chat','voice','whatsapp','instagram','facebook','phone','api')),
  status            text not null default 'ai_active'
                      check (status in ('ai_active','human_active','closed','expired')),
  ai_enabled        boolean not null default true,
  language          text,
  visitor_id        text,
  customer_id       text,
  assigned_agent_id uuid references public.users(id) on delete set null,
  current_intent    text,
  state_json        jsonb not null default '{}'::jsonb,
  started_at        timestamptz not null default now(),
  last_message_at   timestamptz not null default now(),
  unread_count      integer not null default 0,
  closed_at         timestamptz,
  expires_at        timestamptz
);

create index if not exists idx_conversations_company on public.conversations(company_id);
create index if not exists idx_conversations_bot on public.conversations(bot_id);
create index if not exists idx_conversations_inbox on public.conversations(company_id, last_message_at desc);

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  channel         text not null default 'web_chat',
  sender_type     text not null check (sender_type in ('visitor','ai','agent','system')),
  sender_id       text,
  content_text    text not null default '',
  content_type    text not null default 'text'
                    check (content_type in ('text','audio','image','file','system')),
  language        text,
  metadata_json   jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists idx_messages_conversation on public.messages(conversation_id, created_at);
create index if not exists idx_messages_company on public.messages(company_id);

-- RLS: members read their company's conversations/messages; super admins read all.
-- Writes happen via the service-role client in guarded server actions / the engine.
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

drop policy if exists conversations_select_members on public.conversations;
create policy conversations_select_members on public.conversations
  for select to authenticated using (company_id in (select public.user_company_ids()));
drop policy if exists conversations_super_admin_all on public.conversations;
create policy conversations_super_admin_all on public.conversations
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists messages_select_members on public.messages;
create policy messages_select_members on public.messages
  for select to authenticated using (company_id in (select public.user_company_ids()));
drop policy if exists messages_super_admin_all on public.messages;
create policy messages_super_admin_all on public.messages
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

-- Enable Supabase Realtime for the inbox (idempotent guards).
do $$
begin
  begin
    alter publication supabase_realtime add table public.messages;
  exception when duplicate_object then null; end;
  begin
    alter publication supabase_realtime add table public.conversations;
  exception when duplicate_object then null; end;
end$$;
