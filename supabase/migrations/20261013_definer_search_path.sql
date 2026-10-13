-- v1.18.1 (limecore#63 §4) — the two SECURITY DEFINER functions look up names
-- in pg_catalog first.
--
-- `purge_soft_deleted(interval)` and `erase_audit_log_for_user()` run as their
-- owner, with `search_path = public, pg_catalog`. With `public` first, an
-- object created there with a built-in's name (a function or operator) is
-- found before the built-in and runs with the owner's rights. Nothing like
-- that exists today, and users cannot create objects in `public` through the
-- API; this removes the possibility rather than relying on that.
--
-- pg_catalog first, then public (the functions' own tables, as before), then
-- pg_temp last: when pg_temp is not listed, Postgres searches it FIRST for
-- tables, which is the other half of the same advice for definer functions.
-- The function bodies are unchanged.
--
-- NOT APPLIED. The owner applies it. Idempotent: safe to run twice.

alter function public.purge_soft_deleted(interval) set search_path = pg_catalog, public, pg_temp;
alter function public.erase_audit_log_for_user() set search_path = pg_catalog, public, pg_temp;

-- Check afterwards (expect search_path=pg_catalog, public, pg_temp for both):
--   select p.oid::regprocedure, p.proconfig from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname in ('purge_soft_deleted', 'erase_audit_log_for_user');
