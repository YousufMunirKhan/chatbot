-- ===========================================================================
-- Migration 0003 — Authentication & Role-Based Access
-- Module 3.
--  * Links Supabase auth.users -> public.users (auto-provisioned profile)
--  * Adds the platform super-admin flag
--  * Adds an is_super_admin() RLS helper + super-admin override policies
-- ===========================================================================

-- 1. Platform super-admin flag on the profile table.
alter table public.users
  add column if not exists is_super_admin boolean not null default false;

-- 2. Auto-provision a public.users profile whenever an auth user is created.
--    Convention: public.users.id == auth.users.id == auth.uid()
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name')
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3. RLS helper: is the current user a platform super admin?
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_super_admin from public.users where id = auth.uid()), false);
$$;

-- 4. Super-admin override policies — full access to all platform data
--    (Access Rule: "Super admin can access all platform data").
do $$
declare t text;
begin
  foreach t in array array[
    'companies','company_users','bots','bot_settings',
    'company_settings','audit_logs','platform_settings','users'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_super_admin_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin())',
      t || '_super_admin_all', t
    );
  end loop;
end$$;

-- Note: company-admin / agent WRITES are performed by server actions using the
-- service-role client, authorized in application code (requireRole). RLS here is
-- defense-in-depth governing direct authenticated (publishable-key) access:
--   * members get scoped SELECT (migration 0002)
--   * super admins get full access (above)
--   * platform_settings stays super-admin / service-role only
