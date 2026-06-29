-- ===========================================================================
-- Migration 0036 - Audience-safe default/contextual quick action metadata
-- Keeps existing customer quick actions working while allowing internal Help
-- Desk pills and connector-generated contextual/navigation/action pills.
-- ===========================================================================

alter table public.bot_quick_actions
  add column if not exists audience text not null default 'customer'
    check (audience in ('customer','internal','both')),
  add column if not exists source text not null default 'manual'
    check (source in ('manual','default','connector','ai_contextual')),
  add column if not exists context_mode text not null default 'initial'
    check (context_mode in ('initial','contextual','follow_up','navigation','action')),
  add column if not exists connector_document_id uuid references public.helpdesk_connector_documents(id) on delete set null,
  add column if not exists connector_action_id uuid references public.helpdesk_connector_actions(id) on delete set null;

update public.bot_quick_actions
set source = 'default'
where source = 'manual'
  and coalesce(action_config_json->>'seeded', 'false') = 'true';

update public.bot_quick_actions
set audience = 'internal'
where audience = 'customer'
  and bot_id in (
    select id
    from public.bots
    where bot_type = 'help_desk'
       or appearance_json->>'assistantAudience' = 'internal'
       or exists (
         select 1
         from unnest(capability_flags) cap(value)
         where cap.value like 'internal_%'
            or cap.value = 'help_desk'
       )
  );

create index if not exists idx_bot_quick_actions_audience
  on public.bot_quick_actions(company_id, bot_id, audience, is_active, priority);

create index if not exists idx_bot_quick_actions_source
  on public.bot_quick_actions(company_id, source, context_mode, is_active, priority);

create index if not exists idx_bot_quick_actions_connector_doc
  on public.bot_quick_actions(connector_document_id)
  where connector_document_id is not null;

create index if not exists idx_bot_quick_actions_connector_action
  on public.bot_quick_actions(connector_action_id)
  where connector_action_id is not null;
