-- Store the kind of quality fix and indexing result for each correction.
alter table public.answer_quality_feedback
  add column if not exists metadata_json jsonb not null default '{}'::jsonb;
