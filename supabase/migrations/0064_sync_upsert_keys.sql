-- ===========================================================================
-- Migration 0064 — Give the shop sync a real upsert key
--
-- `upsertByExternalId` in src/lib/integrations/sync.ts reads a row by
-- (company_id, external_id), then inserts or updates depending on what it
-- found. Nothing in the schema enforced that pair, which cost two things.
--
-- It is slow. Every product costs a SELECT and then a write, so a catalogue of
-- a thousand products is two thousand sequential round trips before variants
-- and inventory are even considered. With a unique key the whole page becomes
-- one `insert ... on conflict do update`.
--
-- It is also racy. Two syncs overlapping — an hourly cron and someone pressing
-- "Refresh now" — can both read "no such row" and both insert it, leaving
-- duplicate products that the assistant will happily quote twice.
--
-- The indexes are deliberately NOT partial. A `where external_id is not null`
-- predicate reads better, but Postgres will only use a partial index to resolve
-- `on conflict` if the statement repeats that predicate, and PostgREST gives no
-- way to send one — so the upsert would fail to find an arbiter index and error.
-- A plain unique index is safe here anyway: nulls compare as distinct by
-- default, so the CSV-imported rows that carry no external id remain free to
-- repeat exactly as before.
--
-- Existing duplicates are collapsed first, keeping the most recently created
-- row of each group, because that is the one the last sync wrote.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- Collapse any duplicates the racy path already created.
-- --------------------------------------------------------------------------
delete from public.synced_product_variants v
where v.id in (
  select id from (
    select id, row_number() over (
      partition by company_id, product_id, external_id order by created_at desc, id desc
    ) as rn
    from public.synced_product_variants
    where external_id is not null
  ) ranked
  where ranked.rn > 1
);

delete from public.synced_products p
where p.id in (
  select id from (
    select id, row_number() over (
      partition by company_id, external_id order by created_at desc, id desc
    ) as rn
    from public.synced_products
    where external_id is not null
  ) ranked
  where ranked.rn > 1
);

delete from public.synced_orders o
where o.id in (
  select id from (
    select id, row_number() over (
      partition by company_id, external_id order by created_at desc, id desc
    ) as rn
    from public.synced_orders
    where external_id is not null
  ) ranked
  where ranked.rn > 1
);

delete from public.synced_customers c
where c.id in (
  select id from (
    select id, row_number() over (
      partition by company_id, external_id order by created_at desc, id desc
    ) as rn
    from public.synced_customers
    where external_id is not null
  ) ranked
  where ranked.rn > 1
);

-- --------------------------------------------------------------------------
-- The keys themselves.
--
-- A variant's external id is only unique within its product — two products in
-- the same shop can both have a "Large" variant — so that one is keyed by
-- product as well.
-- --------------------------------------------------------------------------
create unique index if not exists uq_synced_products_external
  on public.synced_products (company_id, external_id);

create unique index if not exists uq_synced_orders_external
  on public.synced_orders (company_id, external_id);

create unique index if not exists uq_synced_customers_external
  on public.synced_customers (company_id, external_id);

create unique index if not exists uq_synced_variants_external
  on public.synced_product_variants (company_id, product_id, external_id);

-- --------------------------------------------------------------------------
-- A sync now reports whether it saw the whole catalogue.
--
-- The old run stopped after five pages and recorded a success. An operator with
-- more than five hundred products was told the sync "completed" while the
-- assistant quoted from a partial catalogue and never mentioned it. These two
-- columns let the page say "stopped at 5,000 of about 12,000" instead.
-- --------------------------------------------------------------------------
alter table public.sync_jobs
  add column if not exists truncated boolean not null default false;

alter table public.sync_jobs
  add column if not exists warning_message text;
