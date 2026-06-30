-- Make Help Desk visibility opt-out by default.
-- Empty allowed_roles/allowed_routes means "show for all staff roles/routes";
-- blocked_routes remains the safety stop-list for login, payment, checkout,
-- customer-facing, and customer-display screens.

alter table public.helpdesk_chat_settings
  alter column allowed_roles set default '{}'::text[],
  alter column allowed_routes set default '{}'::text[];

update public.helpdesk_chat_settings
set
  allowed_roles = '{}'::text[],
  allowed_routes = '{}'::text[]
where allowed_roles = array['admin','manager','staff']::text[]
  and allowed_routes = array['dashboard','inventory/*','purchase/*','reports/*','customers/*','orders/*']::text[];
