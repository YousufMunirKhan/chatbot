-- ===========================================================================
-- Migration 0032 - Auto-audit, super-admin chat logs, and company tone controls
-- Additive/idempotent so the same file can be applied locally and in live.
-- ===========================================================================

alter table public.answer_quality_logs
  add column if not exists auto_audit_status text not null default 'pending'
    check (auto_audit_status in ('pending','perfect','acceptable','needs_review','failed')),
  add column if not exists auto_audit_score integer
    check (auto_audit_score is null or (auto_audit_score >= 0 and auto_audit_score <= 100)),
  add column if not exists auto_audit_label text
    check (auto_audit_label is null or auto_audit_label in (
      'perfect','acceptable','missing_info','wrong_answer','weak_retrieval',
      'hallucination_risk','needs_human','too_slow','tool_failed','model_error','bad_tone'
    )),
  add column if not exists auto_audit_reason text,
  add column if not exists suggested_fix text,
  add column if not exists reviewed_by uuid references public.users(id) on delete set null,
  add column if not exists reviewed_at timestamptz;

alter table public.company_business_profiles
  add column if not exists answer_length text not null default 'balanced'
    check (answer_length in ('short','balanced','detailed')),
  add column if not exists answer_strictness text not null default 'grounded'
    check (answer_strictness in ('strict','grounded','flexible')),
  add column if not exists sales_style text not null default 'helpful'
    check (sales_style in ('support_only','helpful','sales_focused')),
  add column if not exists tone_notes text,
  add column if not exists banned_phrases text[] not null default '{}',
  add column if not exists escalation_message text;

create index if not exists idx_admin_access_logs_created
  on public.admin_access_logs(created_at desc);
create index if not exists idx_admin_access_logs_company_created
  on public.admin_access_logs(company_id, created_at desc);

create index if not exists idx_audit_logs_created
  on public.audit_logs(created_at desc);
create index if not exists idx_audit_logs_company_created
  on public.audit_logs(company_id, created_at desc);

create index if not exists idx_conversations_company_status_activity
  on public.conversations(company_id, status, last_message_at desc);
create index if not exists idx_conversations_activity
  on public.conversations(last_message_at desc);

create index if not exists idx_messages_conversation_created_desc
  on public.messages(conversation_id, created_at desc);
create index if not exists idx_messages_company_created
  on public.messages(company_id, created_at desc);

create index if not exists idx_quality_auto_audit
  on public.answer_quality_logs(company_id, auto_audit_status, created_at desc);
create index if not exists idx_quality_conversation_created
  on public.answer_quality_logs(conversation_id, created_at desc);

-- Backfill old quality rows with deterministic audit labels. This keeps older
-- logs useful without running expensive AI grading retroactively.
update public.answer_quality_logs
set
  auto_audit_status = case
    when failure_reason is null and coalesce(confidence_score, 0) >= 0.75 then 'perfect'
    when failure_reason is null then 'acceptable'
    else 'needs_review'
  end,
  auto_audit_score = case
    when failure_reason is null and coalesce(confidence_score, 0) >= 0.75 then 95
    when failure_reason is null then 82
    when failure_reason = 'missing_info' then 45
    when failure_reason = 'weak_retrieval' then 55
    when failure_reason = 'human_needed' then 50
    when failure_reason = 'tool_failed' then 40
    when failure_reason = 'model_error' then 20
    else 60
  end,
  auto_audit_label = case
    when failure_reason = 'missing_info' then 'missing_info'
    when failure_reason = 'weak_retrieval' then 'weak_retrieval'
    when failure_reason = 'human_needed' then 'needs_human'
    when failure_reason = 'tool_failed' then 'tool_failed'
    when failure_reason = 'model_error' then 'model_error'
    when failure_reason is null and coalesce(confidence_score, 0) >= 0.75 then 'perfect'
    else 'acceptable'
  end,
  auto_audit_reason = case
    when failure_reason is null then 'No automatic issue detected.'
    else 'Automatic audit detected ' || replace(failure_reason, '_', ' ') || '.'
  end,
  suggested_fix = case
    when failure_reason = 'missing_info' then 'Add the missing answer to the company knowledge base, FAQ, policy, or product/service data.'
    when failure_reason = 'weak_retrieval' then 'Improve or re-index the relevant knowledge source so retrieval can find the answer.'
    when failure_reason = 'human_needed' then 'Review escalation rules and route this topic to a human sooner.'
    when failure_reason = 'tool_failed' then 'Check the connected integration/tool and verify the required fields.'
    when failure_reason = 'model_error' then 'Review the provider/model error and retry after fixing configuration.'
    else null
  end
where auto_audit_status = 'pending';
