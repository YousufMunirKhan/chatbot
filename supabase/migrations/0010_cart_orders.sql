-- ===========================================================================
-- Migration 0010 — Conversational order placement (Module 18)
-- chat_carts / chat_cart_items / chat_orders / chat_order_items / payments.
-- Backend validates & prices; AI never creates a final order without confirmation.
-- ===========================================================================

create table if not exists public.chat_carts (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  status          text not null default 'open' check (status in ('open','ordered','abandoned')),
  currency        text not null default 'USD',
  subtotal        numeric(12,2) not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_chat_carts_company on public.chat_carts(company_id);

create table if not exists public.chat_cart_items (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  cart_id       uuid not null references public.chat_carts(id) on delete cascade,
  product_id    uuid,
  menu_item_id  uuid,
  title         text not null,
  quantity      integer not null default 1,
  unit_price    numeric(12,2) not null default 0,
  options_json  jsonb not null default '{}'::jsonb,
  line_total    numeric(12,2) not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists idx_chat_cart_items_cart on public.chat_cart_items(cart_id);

create table if not exists public.chat_orders (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  cart_id         uuid references public.chat_carts(id) on delete set null,
  order_type      text not null default 'internal'
                    check (order_type in ('internal','shopify_draft','woocommerce','payment_link','cod','manual')),
  status          text not null default 'pending'
                    check (status in ('pending','confirmed','paid','fulfilled','cancelled')),
  customer_name   text,
  customer_phone  text,
  customer_email  text,
  total           numeric(12,2) not null default 0,
  currency        text not null default 'USD',
  external_ref    text,
  metadata_json   jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists idx_chat_orders_company on public.chat_orders(company_id, created_at desc);

create table if not exists public.chat_order_items (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  order_id     uuid not null references public.chat_orders(id) on delete cascade,
  title        text not null,
  quantity     integer not null default 1,
  unit_price   numeric(12,2) not null default 0,
  line_total   numeric(12,2) not null default 0,
  options_json jsonb not null default '{}'::jsonb
);
create index if not exists idx_chat_order_items_order on public.chat_order_items(order_id);

create table if not exists public.payments (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  order_id      uuid references public.chat_orders(id) on delete cascade,
  provider      text not null default 'stripe',
  status        text not null default 'pending'
                  check (status in ('pending','paid','failed','refunded')),
  amount        numeric(12,2) not null default 0,
  currency      text not null default 'USD',
  payment_url   text,
  external_ref  text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_payments_order on public.payments(order_id);

do $$
declare t text;
begin
  foreach t in array array['chat_carts','chat_cart_items','chat_orders','chat_order_items','payments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_super_admin_all', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin())', t || '_super_admin_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_members', t);
    execute format('create policy %I on public.%I for select to authenticated using (company_id in (select public.user_company_ids()))', t || '_select_members', t);
  end loop;
end$$;
