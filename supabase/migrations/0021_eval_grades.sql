-- ===========================================================================
-- Migration 0021 — LLM-graded evaluation
-- Adds answer-quality scoring to eval runs (Module 25 upgrade). Per-question
-- grades live in results_json; these columns expose the aggregate for dashboards.
-- ===========================================================================

alter table public.eval_runs add column if not exists graded boolean not null default false;
alter table public.eval_runs add column if not exists avg_answer_score numeric;
