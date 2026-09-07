-- ===========================================================================
-- Migration 0054 — WhatsApp Business suite
-- Everything a company needs to run WhatsApp as a real sales/marketing channel
-- rather than only an inbound support inbox:
--   * whatsapp_templates          — message templates mirrored from Meta, so
--                                   cold outreach outside the 24h service
--                                   window is possible at all.
--   * contact_subscriptions       — opt-in/opt-out ledger. WhatsApp policy (and
--                                   GDPR/PDPL) requires an auditable consent
--                                   record and an honoured STOP keyword; the
--                                   broadcast dispatcher reads this before it
--                                   sends anything.
--   * whatsapp_catalog_settings   — the Meta commerce catalog id used for
--                                   product / product_list messages, plus the
--                                   retailer id mapping onto synced_products.
--   * whatsapp_guide_progress     — per-company checkbox state for the green /
--                                   blue tick and BSP-migration checklists, so
--                                   a multi-day process survives a page reload.
-- Also widens `broadcasts` from "all leads, session text only" to audience
-- targeting + template sends, which is what makes broadcasts deliverable.
-- ===========================================================================

-- --- Message templates -----------------------------------------------------
create table if not exists public.whatsapp_templates (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies(id) on delete cascade,
  channel_identity_id  uuid references public.channel_identities(id) on delete set null,
  name                 text not null,
  language             text not null default 'en_US',
  category             text not null default 'MARKETING'
                         check (category in ('MARKETING','UTILITY','AUTHENTICATION')),
  body                 text not null,
  header               jsonb,
  footer               jsonb,
  buttons              jsonb not null default '[]'::jsonb,
  components           jsonb not null default '[]'::jsonb,
  status               text not null default 'draft'
                         check (status in ('draft','pending','approved','rejected')),
  meta_template_id     text,
  rejection_reason     text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index if not exists uq_whatsapp_templates_company_name_lang
  on public.whatsapp_templates(company_id, name, language);
create index if not exists idx_whatsapp_templates_company
  on public.whatsapp_templates(company_id, created_at desc);

alter table public.whatsapp_templates enable row level security;

drop policy if exists whatsapp_templates_super_admin_all on public.whatsapp_templates;
create policy whatsapp_templates_super_admin_all on public.whatsapp_templates
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists whatsapp_templates_select_members on public.whatsapp_templates;
create policy whatsapp_templates_select_members on public.whatsapp_templates
  for select to authenticated using (company_id in (select public.user_company_ids()));

-- --- Opt-in / opt-out ledger ----------------------------------------------
create table if not exists public.contact_subscriptions (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  channel            text not null default 'whatsapp'
                       check (channel in ('whatsapp','instagram','facebook','email','telegram','viber','line','sms')),
  contact_identifier text not null,        -- phone in "+digits" form, or email
  opted_in           boolean not null default true,
  source             text not null default 'manual',  -- keyword | widget | import | manual | api
  opted_in_at        timestamptz,
  opted_out_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists uq_contact_subscriptions_identity
  on public.contact_subscriptions(company_id, channel, contact_identifier);
create index if not exists idx_contact_subscriptions_company
  on public.contact_subscriptions(company_id, channel, opted_in);

alter table public.contact_subscriptions enable row level security;

drop policy if exists contact_subscriptions_super_admin_all on public.contact_subscriptions;
create policy contact_subscriptions_super_admin_all on public.contact_subscriptions
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists contact_subscriptions_select_members on public.contact_subscriptions;
create policy contact_subscriptions_select_members on public.contact_subscriptions
  for select to authenticated using (company_id in (select public.user_company_ids()));

-- --- Commerce catalog ------------------------------------------------------
create table if not exists public.whatsapp_catalog_settings (
  company_id    uuid primary key references public.companies(id) on delete cascade,
  catalog_id    text,
  is_active     boolean not null default false,
  settings_json jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.whatsapp_catalog_settings enable row level security;

drop policy if exists whatsapp_catalog_settings_super_admin_all on public.whatsapp_catalog_settings;
create policy whatsapp_catalog_settings_super_admin_all on public.whatsapp_catalog_settings
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists whatsapp_catalog_settings_select_members on public.whatsapp_catalog_settings;
create policy whatsapp_catalog_settings_select_members on public.whatsapp_catalog_settings
  for select to authenticated using (company_id in (select public.user_company_ids()));

-- The product catalogue lives in synced_products (mirrored from Shopify/Square/
-- CSV). A WhatsApp product message addresses items by the retailer id used in
-- the Meta commerce catalog feed, which need not equal the store SKU.
alter table public.synced_products add column if not exists whatsapp_retailer_id text;
create index if not exists idx_synced_products_retailer
  on public.synced_products(company_id, whatsapp_retailer_id);

-- --- Guide progress --------------------------------------------------------
create table if not exists public.whatsapp_guide_progress (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  guide      text not null check (guide in ('blue_tick','bsp_migration')),
  step_key   text not null,
  done       boolean not null default false,
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_whatsapp_guide_progress_step
  on public.whatsapp_guide_progress(company_id, guide, step_key);

alter table public.whatsapp_guide_progress enable row level security;

drop policy if exists whatsapp_guide_progress_super_admin_all on public.whatsapp_guide_progress;
create policy whatsapp_guide_progress_super_admin_all on public.whatsapp_guide_progress
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists whatsapp_guide_progress_select_members on public.whatsapp_guide_progress;
create policy whatsapp_guide_progress_select_members on public.whatsapp_guide_progress
  for select to authenticated using (company_id in (select public.user_company_ids()));

-- --- Broadcast upgrade -----------------------------------------------------
-- 0046 shipped broadcasts that could only target 'all_leads' with free-form
-- text — undeliverable to anyone outside the 24h window and unable to honour an
-- opt-out. Widen the audience and carry the template payload.
alter table public.broadcasts drop constraint if exists broadcasts_audience_check;
alter table public.broadcasts
  add constraint broadcasts_audience_check
  check (audience in ('all_leads','opted_in','tag','segment','custom'));

alter table public.broadcasts add column if not exists audience_filter jsonb not null default '{}'::jsonb;
alter table public.broadcasts add column if not exists template_name text;
alter table public.broadcasts add column if not exists template_language text;
alter table public.broadcasts add column if not exists template_variables jsonb;
alter table public.broadcasts add column if not exists channel_identity_id uuid
  references public.channel_identities(id) on delete set null;
alter table public.broadcasts add column if not exists scheduled_timezone text;
alter table public.broadcasts add column if not exists failed_count integer not null default 0;
