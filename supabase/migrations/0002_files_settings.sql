-- 0002_files_settings.sql — file storage, provider settings, prompt versions

-- ─── campaign_files (reference files for AI use) ───────────────────────────
create table if not exists public.campaign_files (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  filename text not null,
  storage_path text not null,
  mime text not null,
  size_bytes bigint not null,
  sha256 text not null,
  purpose text not null default 'campaign_reference'
    check (purpose in ('campaign_reference','ticket_supporting','email_attachment')),
  extraction_status text not null default 'pending'
    check (extraction_status in ('pending','extracting','completed','failed')),
  extraction_text text,
  extraction_failure text,
  extracted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists campaign_files_campaign_idx on public.campaign_files(campaign_id);

-- ─── ticket_attachments (outgoing email attachments) ──────────────────────
create table if not exists public.ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  campaign_file_id uuid references public.campaign_files(id) on delete set null,
  filename text not null,
  storage_path text not null,
  mime text not null,
  size_bytes bigint not null,
  sha256 text not null,
  created_at timestamptz not null default now()
);
create index if not exists ticket_attachments_ticket_idx on public.ticket_attachments(ticket_id);

-- ─── provider_settings (one row per AI slot) ──────────────────────────────
create table if not exists public.provider_settings (
  slot text primary key,
  provider text not null check (provider in ('gemini','grok')),
  model_id text not null,
  credential_slot int not null default 1 check (credential_slot between 1 and 4),
  enabled boolean not null default true,
  max_concurrency int not null default 2,
  request_budget_per_minute int not null default 30,
  timeout_ms int not null default 60000,
  retry jsonb not null default '{"max_attempts":3,"base_delay_ms":1000,"max_delay_ms":30000}'::jsonb,
  cooldown_until timestamptz,
  last_error text,
  p50_latency_ms int,
  p95_latency_ms int,
  tokens_in bigint not null default 0,
  tokens_out bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- Seed the 8 logical slots declared in the spec (§4).
insert into public.provider_settings (slot, provider, model_id) values
  ('gemini_analyze','gemini','gemini-1.5-pro'),
  ('gemini_generate','gemini','gemini-1.5-pro'),
  ('gemini_qa_structure','gemini','gemini-1.5-flash'),
  ('gemini_qa_personalization','gemini','gemini-1.5-flash'),
  ('grok_defensibility','grok','grok-2-latest'),
  ('grok_human_tone','grok','grok-2-latest'),
  ('grok_content_fit','grok','grok-2-latest'),
  ('grok_delivery_hygiene','grok','grok-2-latest')
on conflict (slot) do nothing;

-- ─── prompt_versions (editable per-role prompts) ──────────────────────────
create table if not exists public.prompt_versions (
  id uuid primary key default gen_random_uuid(),
  role text not null,
  version int not null,
  system_prompt text not null,
  enabled boolean not null default true,
  author_id uuid references public.profiles(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists prompt_versions_role_idx on public.prompt_versions(role, enabled, created_at desc);

-- ─── sender_accounts (Gmail OAuth) ─────────────────────────────────────────
create table if not exists public.sender_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  email text not null,
  access_token text not null,
  refresh_token_encrypted text,
  token_expires_at timestamptz not null,
  scope text,
  connected_at timestamptz not null default now(),
  unique (owner_id, email)
);

-- ─── send_operations ────────────────────────────────────────────────────────
create table if not exists public.send_operations (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  email_version_id uuid not null references public.email_versions(id) on delete cascade,
  operation_id text not null unique,
  status text not null default 'queued'
    check (status in ('queued','sending','sent','failed','unknown','reconciling')),
  gmail_message_id text,
  gmail_draft_id text,
  attempt int not null default 1,
  attempted_at timestamptz,
  reconciled_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists send_ops_ticket_idx on public.send_operations(ticket_id);
create index if not exists send_ops_status_idx on public.send_operations(status);

-- ─── suppression_list ──────────────────────────────────────────────────────
create table if not exists public.suppression_list (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  email text not null,
  reason text,
  created_at timestamptz not null default now(),
  unique (owner_id, email)
);
create index if not exists suppression_owner_idx on public.suppression_list(owner_id);

-- ─── usage_records ─────────────────────────────────────────────────────────
create table if not exists public.usage_records (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns(id) on delete cascade,
  ticket_id uuid references public.tickets(id) on delete cascade,
  slot text not null,
  provider text not null check (provider in ('gemini','grok')),
  model_id text not null,
  tokens_in int not null default 0,
  tokens_out int not null default 0,
  duration_ms int not null default 0,
  cost_estimate_usd numeric not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists usage_records_campaign_idx on public.usage_records(campaign_id);
create index if not exists usage_records_slot_idx on public.usage_records(slot, created_at desc);

-- ─── global_settings ──────────────────────────────────────────────────────
create table if not exists public.global_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.global_settings (key, value) values
  ('global_send_switch', 'false'::jsonb),
  ('worker_heartbeat', '{"last_beat":null,"online":false}'::jsonb)
on conflict (key) do nothing;
