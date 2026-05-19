-- =============================================================================
-- 20260519000001_harden_definer_functions.sql
-- Address advisor warnings:
--   - function_search_path_mutable on set_updated_at
--   - anon/authenticated_security_definer_function_executable on handle_new_user, notify_on_match
-- These are trigger-only functions; revoking EXECUTE from anon/authenticated/public
-- does not break trigger invocation (triggers bypass EXECUTE checks).
-- =============================================================================

alter function public.set_updated_at() set search_path = pg_catalog, public;

revoke execute on function public.handle_new_user()   from public, anon, authenticated;
revoke execute on function public.notify_on_match()   from public, anon, authenticated;
revoke execute on function public.set_updated_at()    from public, anon, authenticated;
