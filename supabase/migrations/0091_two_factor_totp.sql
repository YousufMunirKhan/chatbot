-- ===========================================================================
-- Migration 0091 — Two-factor authentication that actually exists
--
-- WHAT WAS TRUE BEFORE THIS (read out of 0018, not assumed):
--
--   `public.user_security_settings` (migration 0018) carries
--   `two_factor_enabled boolean not null default false`,
--   `two_factor_verified_at timestamptz`, a `pending_code_hash` /
--   `pending_expires_at` pair for emailed codes, and
--   `two_factor_method text not null default 'email'
--    check (two_factor_method in ('email'))`.
--
--   That check is the whole problem: the only second factor the database will
--   store is an emailed code, which is a second factor in name only — it is
--   delivered to the same inbox that can reset the password. There is no way
--   to represent an authenticator app, so there is no way to build one.
--
-- This migration adds the three things TOTP needs and nothing else:
--
--   1. 'totp' as a permitted method.
--   2. Somewhere to keep the shared secret — ENCRYPTED, never plaintext — plus
--      the last accepted time step, which is what stops a code being replayed.
--   3. Recovery codes, and a company-level policy row.
--
-- THE POLICY IS OFF BY DEFAULT AND STAYS OFF UNTIL A COMPANY ADMIN TURNS IT ON.
-- `company_two_factor_policies` has no row for a company that has never opened
-- the setting, and an absent row means "not required" — so there is no
-- backfill here, deliberately. Nothing in this migration switches 2FA on for
-- anybody. Forcing it on locks small businesses out of accounts they own.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- 1. 'totp' becomes a storable method
-- --------------------------------------------------------------------------
-- A check constraint cannot be extended in place, so it is dropped and re-added
-- with the existing value repeated verbatim plus the new one. Widening a check
-- never re-validates existing rows into failure: every row today says 'email',
-- which is still in the list.
--
-- Found by definition rather than by name. The constraint was created inline by
-- `create table if not exists` in 0018, so its name is whatever Postgres chose
-- on the day this database was first built. A `drop constraint
-- user_security_settings_two_factor_method_check` that guessed wrong would
-- leave the old constraint standing, and this migration would look applied
-- while every TOTP enrolment failed at the last step.
do $$
declare c text;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.user_security_settings'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%two_factor_method%'
  loop
    execute format('alter table public.user_security_settings drop constraint %I', c);
  end loop;
end$$;

alter table public.user_security_settings
  add constraint user_security_settings_two_factor_method_check
  check (two_factor_method in ('email','totp'));

comment on column public.user_security_settings.two_factor_method is
  'Which second factor this user actually holds. ''email'' is the legacy '
  'mailed six-digit code from 0018; ''totp'' is an authenticator app '
  '(RFC 6238). The column only means something when two_factor_enabled is true.';

-- --------------------------------------------------------------------------
-- 2. Where the TOTP secret lives
-- --------------------------------------------------------------------------
-- Two secret columns, not one, because enrolment has a gap in the middle: the
-- person has scanned a QR code but has not yet proved they can produce a code
-- from it. Writing that secret into the live column would mean a scan that
-- silently failed still switched 2FA on, which is precisely how somebody locks
-- themselves out. The pending secret is promoted to the live one only when a
-- correct code arrives, and is thrown away otherwise.
--
-- Both hold the output of `encryptSecret()` from src/lib/crypto.ts
-- (AES-256-GCM under ENCRYPTION_KEY) — the same envelope that protects every
-- other stored credential in this product. A plaintext TOTP secret in a table
-- is worth exactly as much as no second factor at all: anyone who can read the
-- row can mint valid codes forever.
alter table public.user_security_settings
  add column if not exists totp_secret_encrypted text;
alter table public.user_security_settings
  add column if not exists totp_pending_secret_encrypted text;
alter table public.user_security_settings
  add column if not exists totp_pending_started_at timestamptz;
alter table public.user_security_settings
  add column if not exists totp_confirmed_at timestamptz;
alter table public.user_security_settings
  add column if not exists totp_last_step bigint;

comment on column public.user_security_settings.totp_secret_encrypted is
  'The confirmed TOTP shared secret, base32, wrapped by encryptSecret(). Never '
  'stored or logged in plaintext, and never shown again after enrolment.';
comment on column public.user_security_settings.totp_pending_secret_encrypted is
  'A secret that has been shown to the user but not yet proved. Promoted to '
  'totp_secret_encrypted only when they enter a code it generates.';
comment on column public.user_security_settings.totp_last_step is
  'The last RFC 6238 time step accepted for this user. A new code must come '
  'from a LATER step, which is what makes a code single-use: a shoulder-surfed '
  'or replayed code is refused even inside the clock-skew window.';

-- --------------------------------------------------------------------------
-- 3. Recovery codes
-- --------------------------------------------------------------------------
-- Without these, a lost phone is a lost account, and the only way back in is a
-- support request that cannot be honoured safely — the person asking sounds
-- exactly like an attacker who has the password. Ten single-use codes, shown
-- once at enrolment, stored as hashes so a database read cannot spend them.
create table if not exists public.user_recovery_codes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  code_hash   text not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

-- Plain, not partial. A PARTIAL unique index cannot serve a PostgREST
-- `on_conflict`, and this pair is what an upsert would key on.
create unique index if not exists uq_user_recovery_codes_user_hash
  on public.user_recovery_codes(user_id, code_hash);
create index if not exists idx_user_recovery_codes_user
  on public.user_recovery_codes(user_id, used_at);

comment on table public.user_recovery_codes is
  'Single-use backup codes for TOTP. Rows are never deleted when spent — '
  'used_at is stamped instead, so "this code was already used" stays '
  'answerable. Regenerating replaces the whole set.';

-- --------------------------------------------------------------------------
-- 4. The company policy
-- --------------------------------------------------------------------------
-- One row per company, written only when an admin opens the setting. The
-- default on `required` is false so that even an accidental insert leaves 2FA
-- off; the product never writes this row on the company's behalf.
--
-- `required_since` is not decoration. When an admin switches the policy on,
-- every member who has not enrolled yet gets `grace_period_days` from that
-- moment to do it, and is nudged rather than blocked in the meantime. Turning a
-- policy on and ejecting the whole team from their sessions mid-conversation is
-- the behaviour that makes people turn security features off again.
create table if not exists public.company_two_factor_policies (
  company_id        uuid primary key references public.companies(id) on delete cascade,
  required          boolean not null default false,
  grace_period_days integer not null default 14 check (grace_period_days between 0 and 90),
  required_since    timestamptz,
  updated_by        uuid references public.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

drop trigger if exists trg_company_two_factor_policies_updated_at on public.company_two_factor_policies;
create trigger trg_company_two_factor_policies_updated_at
  before update on public.company_two_factor_policies
  for each row execute function public.set_updated_at();

comment on table public.company_two_factor_policies is
  'Per-company two-factor policy. NO ROW MEANS NOT REQUIRED — this table is '
  'written only when a company admin changes the setting themselves, and '
  'nothing in the product creates a row with required = true on their behalf.';
comment on column public.company_two_factor_policies.required_since is
  'When the policy was last switched on. The grace deadline is measured from '
  'here, so switching it off and on again restarts the countdown rather than '
  'ejecting people immediately.';

-- --------------------------------------------------------------------------
-- 5. Row level security
-- --------------------------------------------------------------------------
-- Same shape as every other tenant table: the service-role key bypasses RLS, so
-- the server keeps working; `authenticated` gets only what it should see.
--
-- `user_recovery_codes` deliberately gets NO member-readable policy at all.
-- Even a hash of a recovery code is something an attacker with a session would
-- like to have offline, and nothing in the product needs to read these rows as
-- the end user — every read goes through the service client during a sign-in
-- challenge the user has not yet completed.
alter table public.user_recovery_codes enable row level security;
drop policy if exists user_recovery_codes_super_admin_all on public.user_recovery_codes;
create policy user_recovery_codes_super_admin_all on public.user_recovery_codes
  for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

alter table public.company_two_factor_policies enable row level security;
drop policy if exists company_two_factor_policies_super_admin_all on public.company_two_factor_policies;
create policy company_two_factor_policies_super_admin_all on public.company_two_factor_policies
  for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- Members may READ their own company's policy — the security page tells them
-- plainly whether their employer requires this and by when. Writing it stays
-- with the server, which checks the company_admin role first.
drop policy if exists company_two_factor_policies_select_members on public.company_two_factor_policies;
create policy company_two_factor_policies_select_members on public.company_two_factor_policies
  for select to authenticated
  using (company_id in (select public.user_company_ids()));
