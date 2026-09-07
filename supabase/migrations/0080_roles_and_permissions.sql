-- ===========================================================================
-- Migration 0080 — Roles on invitations, and permissions that finally mean
--                  something
--
-- WHAT WAS ACTUALLY TRUE BEFORE THIS (all three claims verified against the
-- migration history, not assumed):
--
--   * `public.permissions` exists since 0002 with ten seeded keys, and
--     `public.company_users.permissions_json` exists since 0002 with a
--     `'{}'::jsonb` default. `grep -rn "permissions_json" src/` and
--     `grep -rn "from('permissions')" src/` both return nothing: two pieces of
--     schema that have been carried for 78 migrations with no reader anywhere.
--
--   * `public.company_users.role` is NOT check-constrained. It is
--     `text not null references public.roles(key)` (0002), and `public.roles`
--     already holds 'super_admin', 'company_admin' and 'agent'. So the database
--     has always been willing to store a company admin on a membership row;
--     nothing needed widening there and nothing is touched here.
--
--   * The constraint that really did pin every invitation to one role is on the
--     OTHER table: `public.agent_invites.role`, declared in 0015 as
--     `text not null default 'agent' check (role in ('agent'))`. That is what
--     made `inviteAgentAction`'s hardcoded `role: ROLES.AGENT` the only value
--     the table would accept. It is widened below.
--
-- A check constraint cannot be extended in place, so it is dropped and re-added
-- with the existing value repeated verbatim plus the new one. Widening a check
-- never re-validates existing rows into failure, so this is safe against live
-- data: every row already says 'agent'.
--
-- 'super_admin' is deliberately NOT in the new list. It is a platform role held
-- on `public.users.is_super_admin`, not a company membership, and an invitation
-- that could mint one would let any tenant admin grant themselves the platform.
-- The application refuses it as well (`ASSIGNABLE_ROLES` in
-- `src/lib/permissions.ts`); this is the second lock on the same door.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- 1. Invitations may name a role
-- --------------------------------------------------------------------------
-- Found by definition rather than by name. The constraint was created inline by
-- `create table if not exists` in 0015, so its name is whatever Postgres chose
-- on the day this project's database was first built, and a `drop constraint
-- agent_invites_role_check` that guessed wrong would leave the old one standing
-- and this migration would look applied while every non-agent invite failed.
do $$
declare c text;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.agent_invites'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table public.agent_invites drop constraint %I', c);
  end loop;
end$$;

alter table public.agent_invites
  add constraint agent_invites_role_check
  check (role in ('agent','company_admin'));

comment on column public.agent_invites.role is
  'The company role this invitation grants on acceptance. Company roles only — '
  'never ''super_admin'', which is a platform flag on public.users and not a '
  'membership.';

-- --------------------------------------------------------------------------
-- 2. Invitations may also carry permission overrides
-- --------------------------------------------------------------------------
-- Without this the role picked on the invite form would survive acceptance but
-- the per-person tweaks beside it would not, so an admin would set access twice:
-- once when inviting, once again after the person appeared in the list.
alter table public.agent_invites
  add column if not exists permissions_json jsonb not null default '{}'::jsonb;

comment on column public.agent_invites.permissions_json is
  'Permission overrides to copy onto company_users.permissions_json when this '
  'invitation is accepted. Same shape as that column: a flat map of permission '
  'key to boolean holding only the DIFFERENCES from the role default.';

-- --------------------------------------------------------------------------
-- 3. What `permissions_json` holds
-- --------------------------------------------------------------------------
-- The shape is a flat `{"reports.view": true, "leads.export": false}` map, the
-- same shape `subscriptions.feature_overrides` already uses in
-- `src/lib/entitlements.ts` — one override idiom in this codebase, not two.
--
-- It stores only the DIFFERENCES from the role's defaults. That is the whole
-- reason an existing member is unaffected by this migration: every row in the
-- table today holds `{}`, which resolves to exactly the role's default set,
-- which is exactly what that person could do yesterday. It also means changing
-- somebody's role later moves their baseline with it, instead of freezing a
-- snapshot of one role's permissions onto them forever.
comment on column public.company_users.permissions_json is
  'Per-member permission overrides as a flat map of permission key to boolean, '
  'holding only the differences from the role default. {} — the default and the '
  'value in every row before migration 0080 — means "exactly what this role can '
  'do". Resolved by src/lib/permissions.ts; public.permissions lists the keys.';

-- A jsonb column will happily accept `[]`, `"agent"` or `null`-as-json, none of
-- which the resolver can read as a map. It drops what it cannot understand
-- rather than throwing, so a malformed value would degrade to "role defaults"
-- silently and an admin's revocation would appear to have been accepted and
-- then not apply. Refusing the write is the honest failure.
alter table public.company_users
  drop constraint if exists company_users_permissions_json_object;
alter table public.company_users
  add constraint company_users_permissions_json_object
  check (jsonb_typeof(permissions_json) = 'object');

alter table public.agent_invites
  drop constraint if exists agent_invites_permissions_json_object;
alter table public.agent_invites
  add constraint agent_invites_permissions_json_object
  check (jsonb_typeof(permissions_json) = 'object');

-- --------------------------------------------------------------------------
-- 4. The permission catalogue
-- --------------------------------------------------------------------------
-- One row per key in `PERMISSIONS` in `src/lib/permissions.ts`. The keys are the
-- areas the product actually has, read off the dashboard sidebar
-- (`src/components/dashboard-nav-items.ts`) rather than invented: every sidebar
-- row lands under exactly one key here.
--
-- All ten keys seeded in 0002 are kept verbatim — this is an extension of that
-- vocabulary, not a replacement for it. `do update` on the description keeps
-- this table and the labels in the code from drifting; the key is the contract
-- and no key is ever renamed.
insert into public.permissions (key, description) values
  ('inbox.view',           'See the chat inbox'),
  ('inbox.reply',          'Reply in chats and take over from the assistant'),
  ('customers.view',       'See the customer list and individual customer records'),
  ('leads.view',           'See enquiries'),
  ('leads.export',         'Download enquiries as a spreadsheet'),
  ('orders.view',          'See orders and order enquiries'),
  ('appointments.view',    'See and manage booking requests'),
  ('helpdesk.view',        'Use the staff help desk'),
  ('bots.manage',          'Create and configure assistants, business info, chat buttons, guided chats and trigger phrases'),
  ('quality.manage',       'Review answers and improve them'),
  ('channels.manage',      'Set up website chat, messaging apps and WhatsApp'),
  ('catalog.manage',       'Manage products'),
  ('campaigns.manage',     'Send automatic messages, bulk messages and chat invites'),
  ('reports.view',         'See reports, usage and limits'),
  ('notifications.manage', 'Decide who on the team gets told about what'),
  ('agents.manage',        'Invite teammates and change what they can do'),
  ('billing.manage',       'Manage the plan, payment details and credit'),
  ('integrations.manage',  'Connect and configure other apps'),
  ('settings.manage',      'Change company settings, privacy, security and developer tools')
on conflict (key) do update set description = excluded.description;

-- --------------------------------------------------------------------------
-- 5. Carry an accepted invitation's role onto the membership row
-- --------------------------------------------------------------------------
-- `src/app/agent-invite/[token]/actions.ts` inserts the membership with a
-- literal `role: ROLES.AGENT`. That file is owned by another workstream this
-- run, and without the role reaching the membership the whole feature is a lie:
-- an owner picks "Owner" on the invite form, the invitation stores it, the
-- person accepts, and they arrive as an agent with no error anywhere.
--
-- So the join is closed here, next to the columns it is joining. The trigger
-- reads the pending invitation this membership is being created for — matched on
-- company and email, which is the only thing the two rows share — and stamps its
-- role and overrides onto the new row.
--
-- It is written to become a no-op rather than a second opinion once the accept
-- action passes the role itself: it assigns the SAME value the invitation holds,
-- so an app that already got it right is not contradicted. Overrides are only
-- filled in when the insert left them empty, so an explicit set always wins.
--
-- The three insert paths into `company_users` are the accept action above,
-- self-serve signup (`src/modules/onboarding/provision.ts`) and operator
-- onboarding (`src/modules/super-admin/actions.ts`). The latter two create the
-- company in the same breath, so no invitation for it can exist yet and this
-- costs them one primary-key lookup and nothing else.
--
-- `security definer` because `agent_invites` has row-level security on and the
-- trigger must see the invitation regardless of who is inserting. It is NOT
-- guarded on a JWT claim: this project uses Supabase's new opaque `sb_secret_…`
-- keys, so `current_setting('request.jwt.claim.role', true)` is always null and
-- such a guard would refuse the server's own writes. A trigger function is
-- reachable only by writing to the table it is attached to, which RLS and the
-- application's own checks already govern; the execute grant is narrowed anyway.
create or replace function public.company_users_adopt_invite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  member_email text;
  invited_role text;
  invited_permissions jsonb;
begin
  select u.email into member_email from public.users u where u.id = new.user_id;
  if member_email is null then
    return new;
  end if;

  -- Newest matching invitation wins. `agent_invites` is unique on
  -- (company_id, email, revoked_at) and nulls are distinct there, so a company
  -- can hold several live invitations for one address; the most recent one is
  -- the decision the admin most recently made.
  select ai.role, ai.permissions_json
    into invited_role, invited_permissions
    from public.agent_invites ai
   where ai.company_id = new.company_id
     and lower(ai.email) = lower(member_email)
     and ai.accepted_at is null
     and ai.revoked_at is null
     and ai.expires_at > now()
   order by ai.created_at desc
   limit 1;

  if invited_role is null then
    return new;
  end if;

  new.role := invited_role;
  if new.permissions_json is null or new.permissions_json = '{}'::jsonb then
    new.permissions_json := coalesce(invited_permissions, '{}'::jsonb);
  end if;

  return new;
end;
$$;

revoke execute on function public.company_users_adopt_invite() from public;
revoke execute on function public.company_users_adopt_invite() from anon;
revoke execute on function public.company_users_adopt_invite() from authenticated;
grant execute on function public.company_users_adopt_invite() to service_role;

drop trigger if exists trg_company_users_adopt_invite on public.company_users;
create trigger trg_company_users_adopt_invite
  before insert on public.company_users
  for each row execute function public.company_users_adopt_invite();

-- The lookup above is by company and lower(email); 0015 indexed
-- `lower(email)` alone, which makes the company filter a scan of every
-- invitation ever sent to that address across the platform.
create index if not exists idx_agent_invites_company_email
  on public.agent_invites(company_id, lower(email));
