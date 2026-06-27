-- ===========================================================================
-- Migration 0009 — Structured business data (Module 15)
-- Products / variants / inventory / orders / customers + restaurant menu model.
-- These are the SOURCE OF TRUTH for facts — the AI never invents price/stock.
-- ===========================================================================

create table if not exists public.synced_customers (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  external_id   text,
  name          text,
  email         text,
  phone         text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists idx_synced_customers_company on public.synced_customers(company_id);
create index if not exists idx_synced_customers_lookup on public.synced_customers(company_id, phone, email);

create table if not exists public.synced_products (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  external_id   text,
  title         text not null,
  description   text,
  category      text,
  price         numeric(12,2),
  currency      text not null default 'USD',
  sku           text,
  status        text not null default 'active',
  metadata_json jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists idx_synced_products_company on public.synced_products(company_id);
create index if not exists idx_synced_products_search on public.synced_products
  using gin (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(description,'')));

create table if not exists public.synced_product_variants (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  product_id    uuid not null references public.synced_products(id) on delete cascade,
  external_id   text,
  title         text,
  price         numeric(12,2),
  sku           text,
  options_json  jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists idx_variants_product on public.synced_product_variants(product_id);

create table if not exists public.synced_inventory (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  product_id    uuid references public.synced_products(id) on delete cascade,
  variant_id    uuid references public.synced_product_variants(id) on delete cascade,
  quantity      integer not null default 0,
  in_stock      boolean not null default true,
  location      text,
  updated_at    timestamptz not null default now()
);
create index if not exists idx_inventory_product on public.synced_inventory(product_id);

create table if not exists public.synced_orders (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  external_id     text,
  order_number    text,
  customer_name   text,
  customer_email  text,
  customer_phone  text,
  status          text,
  fulfillment_status text,
  tracking_number text,
  tracking_url    text,
  total           numeric(12,2),
  currency        text not null default 'USD',
  placed_at       timestamptz,
  metadata_json   jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists idx_synced_orders_company on public.synced_orders(company_id);
create index if not exists idx_synced_orders_lookup on public.synced_orders(company_id, order_number);

create table if not exists public.synced_order_items (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  order_id     uuid not null references public.synced_orders(id) on delete cascade,
  title        text,
  quantity     integer not null default 1,
  price        numeric(12,2),
  metadata_json jsonb not null default '{}'::jsonb
);
create index if not exists idx_order_items_order on public.synced_order_items(order_id);

-- --- Restaurant-specific model (Module 15 "Restaurant Support Must Include") ---
create table if not exists public.restaurant_menu_items (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  name          text not null,
  description   text,
  category      text,
  base_price    numeric(12,2),
  currency      text not null default 'USD',
  is_available  boolean not null default true,
  allergy_notes text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists idx_menu_items_company on public.restaurant_menu_items(company_id);

create table if not exists public.restaurant_menu_variants (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  menu_item_id uuid not null references public.restaurant_menu_items(id) on delete cascade,
  name         text not null,
  price        numeric(12,2)
);

create table if not exists public.modifier_groups (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  name         text not null,
  is_required  boolean not null default false,
  min_select   integer not null default 0,
  max_select   integer
);

create table if not exists public.modifiers (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  modifier_group_id uuid not null references public.modifier_groups(id) on delete cascade,
  name              text not null,
  price             numeric(12,2) not null default 0,
  is_available      boolean not null default true
);

create table if not exists public.menu_item_modifier_groups (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  menu_item_id      uuid not null references public.restaurant_menu_items(id) on delete cascade,
  modifier_group_id uuid not null references public.modifier_groups(id) on delete cascade
);

create table if not exists public.combo_groups (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  name         text not null,
  price        numeric(12,2)
);

create table if not exists public.combo_options (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  combo_group_id  uuid not null references public.combo_groups(id) on delete cascade,
  menu_item_id    uuid references public.restaurant_menu_items(id) on delete set null
);

create table if not exists public.availability_rules (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  menu_item_id uuid references public.restaurant_menu_items(id) on delete cascade,
  day_of_week  integer,
  start_time   text,
  end_time     text
);

create table if not exists public.kitchen_routing_rules (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  category     text,
  station      text
);

-- RLS: members read their company's structured data; super admins all.
do $$
declare t text;
begin
  foreach t in array array[
    'synced_customers','synced_products','synced_product_variants','synced_inventory',
    'synced_orders','synced_order_items','restaurant_menu_items','restaurant_menu_variants',
    'modifier_groups','modifiers','menu_item_modifier_groups','combo_groups','combo_options',
    'availability_rules','kitchen_routing_rules'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_super_admin_all', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin())', t || '_super_admin_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_members', t);
    execute format('create policy %I on public.%I for select to authenticated using (company_id in (select public.user_company_ids()))', t || '_select_members', t);
  end loop;
end$$;
