-- ===========================================================================
-- Migration 0014 - Business memory / company context
-- Structured company facts used for compact prompts, plus guided policies,
-- services, FAQs, locations, and opening hours.
-- ===========================================================================

create table if not exists public.company_business_profiles (
  company_id               uuid primary key references public.companies(id) on delete cascade,
  short_description        text,
  industry                 text,
  target_customers         text,
  brand_voice              text,
  unique_selling_points    text,
  primary_phone            text,
  support_email            text,
  sales_email              text,
  whatsapp                 text,
  public_address           text,
  service_areas            text,
  default_currency         text not null default 'USD',
  payment_methods          text[] not null default '{}',
  social_links_json        jsonb not null default '{}'::jsonb,
  escalation_rules         text,
  lead_qualification_rules text,
  appointment_rules        text,
  updated_by               uuid references public.users(id),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

drop trigger if exists trg_company_business_profiles_updated_at on public.company_business_profiles;
create trigger trg_company_business_profiles_updated_at before update on public.company_business_profiles
  for each row execute function public.set_updated_at();

create table if not exists public.company_locations (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  name            text not null default 'Main location',
  address_line1   text,
  address_line2   text,
  city            text,
  region          text,
  country         text,
  postal_code     text,
  timezone        text,
  phone           text,
  google_maps_url text,
  service_area    text,
  is_primary      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_company_locations_company on public.company_locations(company_id);

drop trigger if exists trg_company_locations_updated_at on public.company_locations;
create trigger trg_company_locations_updated_at before update on public.company_locations
  for each row execute function public.set_updated_at();

create table if not exists public.company_business_hours (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.company_locations(id) on delete cascade,
  day_of_week integer not null check (day_of_week between 0 and 6),
  is_closed   boolean not null default false,
  open_time   time,
  close_time  time,
  notes       text,
  updated_at  timestamptz not null default now(),
  unique (company_id, location_id, day_of_week)
);
create index if not exists idx_company_business_hours_company on public.company_business_hours(company_id);

drop trigger if exists trg_company_business_hours_updated_at on public.company_business_hours;
create trigger trg_company_business_hours_updated_at before update on public.company_business_hours
  for each row execute function public.set_updated_at();

create table if not exists public.company_policies (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  bot_id      uuid references public.bots(id) on delete set null,
  title       text not null,
  category    text not null default 'general',
  content     text not null,
  document_id uuid references public.documents(id) on delete set null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_company_policies_company on public.company_policies(company_id);

drop trigger if exists trg_company_policies_updated_at on public.company_policies;
create trigger trg_company_policies_updated_at before update on public.company_policies
  for each row execute function public.set_updated_at();

create table if not exists public.company_services (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  name             text not null,
  category         text,
  description      text,
  price_from       numeric(12,2),
  price_to         numeric(12,2),
  currency         text not null default 'USD',
  duration_minutes integer,
  booking_required boolean not null default false,
  requirements     text,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_company_services_company on public.company_services(company_id);

drop trigger if exists trg_company_services_updated_at on public.company_services;
create trigger trg_company_services_updated_at before update on public.company_services
  for each row execute function public.set_updated_at();

create table if not exists public.company_faqs (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  bot_id      uuid references public.bots(id) on delete set null,
  question    text not null,
  answer      text not null,
  category    text,
  document_id uuid references public.documents(id) on delete set null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_company_faqs_company on public.company_faqs(company_id);

drop trigger if exists trg_company_faqs_updated_at on public.company_faqs;
create trigger trg_company_faqs_updated_at before update on public.company_faqs
  for each row execute function public.set_updated_at();

do $$
declare t text;
begin
  foreach t in array array[
    'company_business_profiles',
    'company_locations',
    'company_business_hours',
    'company_policies',
    'company_services',
    'company_faqs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_super_admin_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin())',
      t || '_super_admin_all',
      t
    );
    execute format('drop policy if exists %I on public.%I', t || '_select_members', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (company_id in (select public.user_company_ids()))',
      t || '_select_members',
      t
    );
  end loop;
end$$;
