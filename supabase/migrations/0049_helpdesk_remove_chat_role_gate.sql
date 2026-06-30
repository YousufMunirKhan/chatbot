-- Chat visibility is controlled by enabled/show mode and route visibility only.
-- Staff role still flows through chat requests for audit and action permissions,
-- but it no longer hides the Help Desk chat itself.

alter table public.helpdesk_chat_settings
  alter column allowed_roles set default '{}'::text[];

update public.helpdesk_chat_settings
set allowed_roles = '{}'::text[];
