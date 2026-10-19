-- 0009_prompt_unique_constraint.sql
-- Per bug F: add a unique constraint on (role, version) to prevent the
-- prompt POST race condition where two concurrent requests both compute
-- version N+1 and both insert.

alter table public.prompt_versions
  add constraint prompt_versions_role_version_unique unique (role, version);
