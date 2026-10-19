-- 0003_versions_reviews.sql — additional review/QA support tables

-- ─── review_runs (groups of concurrent reviews for one version) ────────────
create table if not exists public.review_runs (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  email_version_id uuid not null references public.email_versions(id) on delete cascade,
  cycle int not null default 1,
  required_reviewers text[] not null default '{}',
  completed_reviewers text[] not null default '{}',
  status text not null default 'running'
    check (status in ('running','completed','failed','superseded')),
  final_decision text check (final_decision in ('pass','revise','blocked','error')),
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists review_runs_ticket_idx on public.review_runs(ticket_id);
create index if not exists review_runs_version_idx on public.review_runs(email_version_id);

-- ─── revision_history ──────────────────────────────────────────────────────
create table if not exists public.revision_history (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  from_version_id uuid references public.email_versions(id) on delete cascade,
  to_version_id uuid references public.email_versions(id) on delete cascade,
  cycle int not null,
  failed_reviewers text[] not null default '{}',
  consolidation text,
  created_at timestamptz not null default now()
);
create index if not exists revision_history_ticket_idx on public.revision_history(ticket_id);

-- ─── queue_job_locks (BullMQ idempotency helper) ───────────────────────────
create table if not exists public.queue_job_locks (
  job_key text primary key,
  ticket_id uuid references public.tickets(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);
create index if not exists queue_locks_ticket_idx on public.queue_job_locks(ticket_id);
