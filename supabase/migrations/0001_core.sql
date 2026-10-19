-- 0001_core.sql — MailPilot AI core schema
-- Tables: profiles, campaigns, campaign_settings, imports, import_rows,
--         contacts, tickets, email_versions, ai_reviews, workflow_events,
--         approval_events, audit_log
--
-- IMPORTANT: this file is the SINGLE source of truth for the core tables.
-- File-attachment storage lives in 0002_files_settings.sql (campaign_files,
-- ticket_attachments, sender_accounts, send_operations, etc.). Do NOT
-- recreate those tables here.

create extension if not exists "pgcrypto";

-- ─── profiles ──────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  -- 'admin' or 'member'. The first user to sign up is auto-promoted to admin
  -- by the `promote_first_admin()` function (see migration 0006).
  role text not null default 'member'
    check (role in ('admin','member')),
  created_at timestamptz not null default now()
);

-- ─── campaigns ──────────────────────────────────────────────────────────────
create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  status text not null default 'draft'
    check (status in ('draft','active','paused','completed','archived')),
  settings_version int not null default 1,
  sending_mode text not null default 'draft'
    check (sending_mode in ('draft','direct')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists campaigns_owner_idx on public.campaigns(owner_id);
create index if not exists campaigns_status_idx on public.campaigns(status);

-- ─── campaign_settings ─────────────────────────────────────────────────────
create table if not exists public.campaign_settings (
  campaign_id uuid primary key references public.campaigns(id) on delete cascade,
  settings_version int not null default 1,
  writing jsonb not null default '{}'::jsonb,
  approval jsonb not null default '{}'::jsonb,
  delivery jsonb not null default '{}'::jsonb,
  revision jsonb not null default '{"max_cycles":3}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ─── imports ───────────────────────────────────────────────────────────────
create table if not exists public.imports (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  filename text not null,
  storage_path text not null,
  mime text not null,
  status text not null default 'uploaded'
    check (status in ('uploaded','import_validating','import_preview',
                      'import_confirmed','import_processing',
                      'import_completed','import_failed','import_cancelled')),
  total_rows int not null default 0,
  valid_rows int not null default 0,
  invalid_rows int not null default 0,
  duplicate_rows int not null default 0,
  report jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists imports_campaign_idx on public.imports(campaign_id);

-- ─── import_rows ───────────────────────────────────────────────────────────
create table if not exists public.import_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.imports(id) on delete cascade,
  row_number int not null,
  raw jsonb not null,
  mapped jsonb not null default '{}'::jsonb,
  status text not null
    check (status in ('valid','invalid','duplicate','empty')),
  reasons text[] not null default '{}',
  stable_hash text not null,
  unique (import_id, row_number)
);
create index if not exists import_rows_import_idx on public.import_rows(import_id);
create index if not exists import_rows_hash_idx on public.import_rows(stable_hash);

-- ─── contacts ──────────────────────────────────────────────────────────────
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  email text not null,
  first_name text,
  last_name text,
  company text,
  job_title text,
  custom_fields jsonb,
  stable_hash text not null,
  created_at timestamptz not null default now(),
  unique (campaign_id, stable_hash)
);
create index if not exists contacts_campaign_idx on public.contacts(campaign_id);
create index if not exists contacts_email_idx on public.contacts(lower(email));

-- ─── tickets ───────────────────────────────────────────────────────────────
create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  recipient_email text not null,
  current_state text not null default 'queued'
    check (current_state in (
      'queued','analyzing','drafting','humanizing','grok_reviews',
      'gemini_qa','quality_gate','revising','pending_approval',
      'approved','ready_to_send','gmail_draft_created','sending',
      'sent','send_status_unknown','needs_attention','paused',
      'blocked','retry_scheduled','failed','cancelled')),
  current_email_version_id uuid,
  approval_status text not null default 'pending'
    check (approval_status in ('pending','approved','rejected',
                               'revision_requested','auto_approved')),
  revision_attempts int not null default 0,
  next_scheduled_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Idempotency: one ticket per (campaign, contact). Re-importing the same
  -- spreadsheet will NOT create duplicate tickets.
  constraint tickets_campaign_contact_unique unique (campaign_id, contact_id)
);
create index if not exists tickets_campaign_idx on public.tickets(campaign_id);
create index if not exists tickets_state_idx on public.tickets(current_state);
create index if not exists tickets_approval_idx on public.tickets(approval_status);

-- ─── email_versions ───────────────────────────────────────────────────────
create table if not exists public.email_versions (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  version_number int not null,
  subject text not null,
  body_plain text not null,
  body_html text,
  source_references jsonb not null default '[]'::jsonb,
  attachment_manifest text[] not null default '{}',
  created_by text not null default 'ai'
    check (created_by in ('ai','human','system')),
  created_at timestamptz not null default now(),
  unique (ticket_id, version_number)
);
create index if not exists email_versions_ticket_idx on public.email_versions(ticket_id);

-- ─── ai_reviews ────────────────────────────────────────────────────────────
create table if not exists public.ai_reviews (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  email_version_id uuid not null references public.email_versions(id) on delete cascade,
  reviewer_role text not null,
  provider text not null check (provider in ('gemini','grok')),
  model_id text not null,
  status text not null check (status in ('running','completed','failed','timeout')),
  score numeric,
  decision text not null check (decision in ('pass','revise','blocked','error')),
  issues jsonb not null default '[]'::jsonb,
  evidence_references text[] not null default '{}',
  summary text not null default '',
  started_at timestamptz not null,
  completed_at timestamptz,
  duration_ms int,
  usage_metadata jsonb,
  error_code text
);
create index if not exists ai_reviews_ticket_idx on public.ai_reviews(ticket_id);
create index if not exists ai_reviews_version_idx on public.ai_reviews(email_version_id);
create index if not exists ai_reviews_role_idx on public.ai_reviews(reviewer_role);

-- ─── workflow_events ───────────────────────────────────────────────────────
create table if not exists public.workflow_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references public.tickets(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete cascade,
  stage text not null,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists workflow_events_ticket_idx on public.workflow_events(ticket_id);
create index if not exists workflow_events_campaign_idx on public.workflow_events(campaign_id);
create index if not exists workflow_events_created_idx on public.workflow_events(created_at desc);

-- ─── approval_events ──────────────────────────────────────────────────────
create table if not exists public.approval_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null check (action in ('approve','reject','revision_request','auto_approve')),
  email_version_id uuid references public.email_versions(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists approval_events_ticket_idx on public.approval_events(ticket_id);

-- ─── audit_log ─────────────────────────────────────────────────────────────
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  resource_type text not null,
  resource_id text,
  campaign_id uuid references public.campaigns(id) on delete cascade,
  ticket_id uuid references public.tickets(id) on delete cascade,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_actor_idx on public.audit_log(actor_id);
create index if not exists audit_log_action_idx on public.audit_log(action);
create index if not exists audit_log_created_idx on public.audit_log(created_at desc);

-- ─── updated_at triggers ───────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end$$;

do $$
declare t text;
begin
  for t in select unnest(array['campaigns','imports','tickets','campaign_settings']) loop
    execute format('drop trigger if exists %I_touch on public.%I;', t, t);
    execute format('create trigger %I_touch before update on public.%I
                    for each row execute function public.touch_updated_at();', t, t);
  end loop;
end$$;
