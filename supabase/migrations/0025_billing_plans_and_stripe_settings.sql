-- ===========================================================================
-- Migration 0025 - Editable billing plan catalogue
-- Super-admin can manage default/customer-facing packages and custom plans.
-- ===========================================================================

alter table public.subscriptions drop constraint if exists subscriptions_plan_check;

create table if not exists public.billing_plans (
  key                  text primary key,
  label                text not null,
  description          text not null default '',
  price_monthly_gbp    numeric(12,2) not null default 0,
  message_limit        integer,
  bot_limit            integer,
  agent_limit          integer,
  integration_limit    integer,
  included_credit_gbp  numeric(12,2) not null default 0,
  trial_days           integer,
  is_public            boolean not null default true,
  is_default           boolean not null default false,
  is_active            boolean not null default true,
  sort_order           integer not null default 100,
  created_by           uuid references public.users(id) on delete set null,
  updated_by           uuid references public.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

drop trigger if exists trg_billing_plans_updated_at on public.billing_plans;
create trigger trg_billing_plans_updated_at before update on public.billing_plans
  for each row execute function public.set_updated_at();

insert into public.billing_plans
  (key,label,description,price_monthly_gbp,message_limit,bot_limit,agent_limit,integration_limit,included_credit_gbp,trial_days,is_public,is_default,is_active,sort_order)
values
  ('free_trial','Free Trial','Proof period for one website assistant. Customer sees messages, not internal AI credit.',0,100,1,1,0,2,14,true,true,true,0),
  ('starter','Starter','Website answers, lead capture, and appointment requests for small businesses.',19,500,1,1,0,5,null,true,true,true,10),
  ('growth','Business','Higher chat volume, support workflows, and one connected business system.',49,2000,2,3,1,15,null,true,true,true,20),
  ('pro','Pro','Operational bots, help desk routing, and multiple integrations.',99,5000,5,10,3,35,null,true,true,true,30),
  ('custom','Custom','Quoted plan for custom volume, integrations, or managed setup.',0,null,null,null,null,0,null,false,true,true,100)
on conflict (key) do update set
  label = excluded.label,
  description = excluded.description,
  price_monthly_gbp = excluded.price_monthly_gbp,
  message_limit = excluded.message_limit,
  bot_limit = excluded.bot_limit,
  agent_limit = excluded.agent_limit,
  integration_limit = excluded.integration_limit,
  included_credit_gbp = excluded.included_credit_gbp,
  trial_days = excluded.trial_days,
  is_default = excluded.is_default,
  sort_order = excluded.sort_order,
  updated_at = now();

alter table public.billing_plans enable row level security;
drop policy if exists billing_plans_super_admin_all on public.billing_plans;
create policy billing_plans_super_admin_all on public.billing_plans
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());
drop policy if exists billing_plans_members_read_public on public.billing_plans;
create policy billing_plans_members_read_public on public.billing_plans
  for select to authenticated using (is_active = true and is_public = true);
