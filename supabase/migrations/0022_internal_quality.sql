-- ===========================================================================
-- Migration 0022 — Quality scores are internal (super-admin only)
-- Companies see actionable suggestions, never raw scores. Remove company-member
-- read access to graded eval runs and raw answer-quality logs (defense in depth;
-- the server uses the service role for the curated, score-free company views).
-- eval_questions stays company-readable so companies keep authoring samples.
-- ===========================================================================

drop policy if exists eval_runs_select_members on public.eval_runs;
drop policy if exists answer_quality_logs_select_members on public.answer_quality_logs;
