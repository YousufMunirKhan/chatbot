-- ===========================================================================
-- Migration 0001 — Foundation extensions
-- Module 1 / Module 2 prerequisite.
-- Enables the Postgres extensions used across the platform:
--   pgvector  -> RAG vector chunks (Module 10)
--   pg_trgm   -> fuzzy text / keyword search (Module 10)
--   pgcrypto  -> gen_random_uuid() for primary keys
-- ===========================================================================

create extension if not exists "pgcrypto";
create extension if not exists "vector";
create extension if not exists "pg_trgm";

-- Full-text search uses built-in tsvector; no extension required.
-- Subsequent migrations (Module 2 onward) create the multi-tenant tables.
