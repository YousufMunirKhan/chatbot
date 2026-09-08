-- ===========================================================================
-- Migration 0086 — The company's dial code
--
-- WHY A NEW COLUMN AND NOT `companies.country`
-- --------------------------------------------
-- `companies.country` (migration 0002) already exists, and it is not usable for
-- this. Three reasons, any one of which is enough:
--
--   1. It holds an ISO-3166 alpha-2 code ('GB', 'AE', 'PK'), not a calling
--      code. Turning one into the other needs a country-to-code table that
--      this project does not have, and that would have to be maintained
--      forever for a value the operator can simply type.
--
--   2. Nobody deliberately set it. Both forms that write it — the company
--      profile form and the super-admin create form — render the select with
--      `defaultValue="GB"`, so every company that has ever saved either form
--      says 'GB' whether or not anyone looked at the field. Reading a phone
--      country out of that would quietly file a Dubai shop's customers under
--      +44 numbers that belong to other people.
--
--   3. Where a company is registered is not where its customers dial from. An
--      agency incorporated in the UK running a Saudi client's WhatsApp line
--      needs +966, and no amount of correctness about `country` would give it.
--
-- So the dial code is stated explicitly, on the business profile, beside the
-- other contact facts an operator already fills in there (primary phone,
-- WhatsApp, support email). Null is a real and permanently supported value: it
-- means "we do not know", and the code that reads it then leaves a nationally
-- written number exactly as it was typed rather than guessing a country.
--
-- WHAT USES IT
-- `toE164WithDialCode` in src/lib/channels/sms.ts, through
-- `normalizeContactPhone` / `displayPhone` in src/modules/contacts/identity.ts:
-- a single leading zero is a national trunk prefix and is replaced by this
-- code, so "07946322081" becomes "+447946322081" and can be messaged.
--
-- The CHECK is the same rule `normalizeDialCode` applies in TypeScript. A
-- calling code is one to three digits and never starts with a zero, so the
-- common paste accident — a whole phone number in the dial code box — is
-- refused by the database as well as by the form.
--
-- SAFE TO RUN TWICE.
-- ===========================================================================

alter table public.company_business_profiles
  add column if not exists dial_code text;

-- `add constraint` has no `if not exists`, and this migration has to stay
-- re-runnable like every other one in this directory.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'company_business_profiles_dial_code_check'
      and conrelid = 'public.company_business_profiles'::regclass
  ) then
    alter table public.company_business_profiles
      add constraint company_business_profiles_dial_code_check
      check (dial_code is null or dial_code ~ '^\+[1-9][0-9]{0,2}$');
  end if;
end $$;

comment on column public.company_business_profiles.dial_code is
  'Country calling code as "+" and 1-3 digits (e.g. +44). Turns a nationally written customer number into an international one. Null means unknown, and unknown stays national rather than being guessed.';
