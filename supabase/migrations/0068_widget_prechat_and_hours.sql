-- ===========================================================================
-- Migration 0068 — Widget pre-chat form + out-of-hours message
--
-- Two settings the website widget has been missing, both per company.
--
-- Why a table rather than more keys in `bots.appearance_json`: that column is
-- the widget's LOOK (colours, labels, launcher) and is served wholesale to
-- anonymous browsers by /api/widget/config. These are policy — whether we
-- demand a name and email before a stranger may type, and what we say when the
-- shop is shut — and they belong to the company, not to one assistant. A
-- company with three bots wants one answer to "do we collect leads", not three
-- that can silently drift apart. It also means an admin editing the design
-- studio's colours can never overwrite the lead-capture rule by saving a form
-- that happened to be rendered before the rule changed.
--
-- Opening hours themselves are NOT stored here. They already live in
-- `company_business_hours` + `company_locations` (migration 0014) and are read
-- by `isCompanyOpenNow()`. This table only holds what to SAY when those hours
-- say the company is closed. A company that never filled its hours in reads as
-- "unknown", and unknown deliberately shows the normal chat.
-- ===========================================================================

create table if not exists public.widget_prechat_settings (
  company_id           uuid primary key references public.companies(id) on delete cascade,

  -- Pre-chat form: ask for contact details before the first message.
  prechat_enabled      boolean not null default false,
  prechat_ask_name     boolean not null default true,
  prechat_ask_email    boolean not null default true,
  prechat_ask_phone    boolean not null default false,
  -- Whether the asked-for fields are mandatory. Off means the form still shows
  -- but a visitor may send it empty, which is a softer ask for sites where a
  -- hard gate costs more conversations than the details are worth.
  prechat_required     boolean not null default true,
  -- A visible way past the form. Default on: a stranger who will not give an
  -- email is still worth talking to, and a wall they cannot pass is a bounce.
  prechat_allow_skip   boolean not null default true,
  prechat_title        text not null default 'Before we start',
  prechat_intro        text not null default 'Leave your details and we can pick this up again if we get cut off.',
  prechat_button_label text not null default 'Start chat',

  -- Out of hours: say the team is away rather than implying someone is there.
  offline_enabled      boolean not null default true,
  offline_message      text not null default 'We are closed at the moment. Leave your details and we will reply as soon as we are back.',
  -- The message form itself. With it off the visitor is told we are closed and
  -- can still chat to the assistant, but nothing is captured for follow-up.
  offline_form_enabled boolean not null default true,
  offline_button_label text not null default 'Leave a message',

  updated_by           uuid references public.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

drop trigger if exists trg_widget_prechat_settings_updated_at on public.widget_prechat_settings;
create trigger trg_widget_prechat_settings_updated_at before update on public.widget_prechat_settings
  for each row execute function public.set_updated_at();

-- Both new widget flows land in `leads`, which is already where the quick
-- action forms put their captures, so the company sees one list. The widget
-- asks "did this visitor already give me their details" on every reload, and
-- that question is answered by conversation id — a column `leads` had no index
-- on, because until now nothing looked a lead up that way.
create index if not exists idx_leads_conversation on public.leads(conversation_id);

alter table public.widget_prechat_settings enable row level security;

drop policy if exists widget_prechat_settings_super_admin_all on public.widget_prechat_settings;
create policy widget_prechat_settings_super_admin_all on public.widget_prechat_settings
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists widget_prechat_settings_select_members on public.widget_prechat_settings;
create policy widget_prechat_settings_select_members on public.widget_prechat_settings
  for select to authenticated using (company_id in (select public.user_company_ids()));

-- Writes go through the service-role client in the guarded settings route, the
-- same way every other company-scoped write in this codebase does.
