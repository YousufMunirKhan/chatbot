-- ===========================================================================
-- Migration 0082 — Scheduled reports, and a record of every send
--
-- Reports could only be looked at. Nothing left the product, so the owner had
-- to remember to visit a page they visit once a quarter, and the number that
-- would have told them something was wrong sat on a screen nobody opened.
--
-- Two tables, and the second one is the point.
--
--   1. `report_schedules` — what to send, how often, and to whom. The cadence
--      is stored as frequency + the day/hour it should land, and the next due
--      instant is stored ALONGSIDE it rather than recomputed on every tick.
--      Finding work is then an index scan over "due before now and still
--      active", the same access path migration 0058 chose for SLA deadlines,
--      instead of loading every schedule in the platform and doing calendar
--      arithmetic in the application to discard almost all of them.
--
--      `next_run_at` is computed in TypeScript (`nextRunAt()` in
--      `src/modules/company/reports-data.ts`) because it depends on the
--      company's own timezone: "07:00 on Monday" has to mean seven in the
--      morning where the shop is, and Postgres would need the same zone
--      lookup plus a second implementation of the same rule.
--
--   2. `report_deliveries` — one row per attempt, including the ones that did
--      not send. A schedule that silently stops emailing is indistinguishable
--      from a quiet month, and the first anybody hears of it is a customer
--      asking why they stopped getting their Monday numbers. `status` and
--      `reason` mean the failure is on the screen next to the schedule that
--      caused it: no email provider configured, no recipients left, the
--      provider rejected the send. Nothing is thrown away.
--
-- On recipients: `text[]`, not a child table. A recipient list has no identity
-- of its own — it is never queried across schedules, never joined to, and is
-- always read and written whole with the schedule it belongs to. A join table
-- would buy a second round trip on every read and nothing else.
--
-- No `report_schedules.days` column: the range is stored as its NAME
-- ('last_30', 'last_month', 'this_quarter'…) and resolved at send time, so a
-- monthly schedule saying "last month" keeps meaning last month rather than
-- freezing the dates that were current when it was created.
-- ===========================================================================

create table if not exists public.report_schedules (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  -- The owner's own name for it; shown in the list and in the email subject.
  name          text not null,
  -- Which report tab is sent. Mirrors the tab keys the reports page uses.
  tab           text not null default 'overview'
                  check (tab in ('overview','team','customers','assistant','sales')),
  -- A named window, resolved at send time. Custom start/end dates are
  -- deliberately not schedulable: a fixed pair of dates emailed every week is
  -- the same numbers over and over.
  range_key     text not null default 'last_30'
                  check (range_key in (
                    'last_7','last_30','last_90',
                    'this_month','last_month','this_quarter','year_to_date'
                  )),
  frequency     text not null check (frequency in ('daily','weekly','monthly')),
  -- 0 = Sunday, matching `DAY_LABELS` in reports-metrics.ts and Postgres' dow.
  -- Only read when frequency = 'weekly'.
  day_of_week   integer not null default 1 check (day_of_week between 0 and 6),
  -- Capped at 28 so a monthly schedule exists in February. Only read when
  -- frequency = 'monthly'.
  day_of_month  integer not null default 1 check (day_of_month between 1 and 28),
  -- Hour of the day in the COMPANY's timezone, not UTC.
  send_hour     integer not null default 7 check (send_hour between 0 and 23),
  recipients    text[] not null default '{}',
  is_active     boolean not null default true,
  last_run_at   timestamptz,
  -- When the sweep should next pick this up. Always set by the application.
  next_run_at   timestamptz not null,
  created_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- The sweep's access path: "active schedules whose time has come".
create index if not exists idx_report_schedules_due
  on public.report_schedules(next_run_at)
  where is_active;
create index if not exists idx_report_schedules_company
  on public.report_schedules(company_id, created_at desc);

drop trigger if exists trg_report_schedules_updated_at on public.report_schedules;
create trigger trg_report_schedules_updated_at before update on public.report_schedules
  for each row execute function public.set_updated_at();

create table if not exists public.report_deliveries (
  id            bigserial primary key,
  company_id    uuid not null references public.companies(id) on delete cascade,
  -- Kept nullable and `on delete set null`: deleting a schedule must not erase
  -- the evidence of what it already sent to whom.
  schedule_id   uuid references public.report_schedules(id) on delete set null,
  -- Denormalised so a delivery row still says what it was after the schedule
  -- it came from has been renamed or deleted.
  schedule_name text,
  tab           text,
  range_label   text,
  period_start  timestamptz,
  period_end    timestamptz,
  status        text not null check (status in ('sent','skipped','failed')),
  -- Machine-readable cause for the two non-sending outcomes, e.g.
  -- 'email_not_configured', 'no_recipients', 'send_rejected', 'report_failed'.
  reason        text,
  recipients    text[] not null default '{}',
  created_at    timestamptz not null default now()
);

create index if not exists idx_report_deliveries_company
  on public.report_deliveries(company_id, created_at desc);
create index if not exists idx_report_deliveries_schedule
  on public.report_deliveries(schedule_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Reads and writes both go through the service-role client inside a
-- `getCompanyId()`-scoped module, so these policies are the second line rather
-- than the first — the `company_id` filter in the data layer is what actually
-- isolates tenants. They are still declared, in the same shape as every other
-- tenant table since 0058, so a future direct-from-the-browser read cannot see
-- another company's schedules or its delivery history.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['report_schedules','report_deliveries'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_super_admin_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin())',
      t || '_super_admin_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_members', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (company_id in (select public.user_company_ids()))',
      t || '_select_members', t);
  end loop;
end $$;
