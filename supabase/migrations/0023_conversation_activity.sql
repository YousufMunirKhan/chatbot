-- ===========================================================================
-- Migration 0023 — Conversation activity hardening (engine.ts review)
--   * AFTER INSERT trigger keeps conversations.last_message_at fresh for EVERY
--     message insert (chat engine + agent replies) via DB now().
--   * Race-free unread increment RPC (replaces the read-modify-write that lost
--     increments under concurrency). Tenant-scoped by company_id.
-- ===========================================================================

create or replace function public.touch_conversation_last_message()
returns trigger language plpgsql as $$
begin
  update public.conversations
    set last_message_at = now()
    where id = NEW.conversation_id;
  return NEW;
end;
$$;

drop trigger if exists trg_messages_touch_conversation on public.messages;
create trigger trg_messages_touch_conversation
  after insert on public.messages
  for each row execute function public.touch_conversation_last_message();

create or replace function public.bump_conversation_unread(p_conversation_id uuid, p_company_id uuid)
returns void language sql as $$
  update public.conversations
    set unread_count = coalesce(unread_count, 0) + 1
    where id = p_conversation_id and company_id = p_company_id;
$$;
