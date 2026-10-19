-- 0004_delivery_audit.sql — delivery & reconciliation support

-- ─── send_reconciliation ───────────────────────────────────────────────────
create table if not exists public.send_reconciliation (
  id uuid primary key default gen_random_uuid(),
  send_operation_id uuid not null references public.send_operations(id) on delete cascade,
  checked_at timestamptz not null default now(),
  gmail_found boolean,
  gmail_message_id text,
  notes text
);
create index if not exists send_recon_op_idx on public.send_reconciliation(send_operation_id);

-- ─── worker_heartbeat ──────────────────────────────────────────────────────
create table if not exists public.worker_heartbeat (
  id text primary key default 'singleton',
  last_beat_at timestamptz,
  queue_depth int not null default 0,
  active_jobs int not null default 0,
  failed_jobs int not null default 0,
  version text
);

insert into public.worker_heartbeat (id) values ('singleton')
on conflict (id) do nothing;

-- ─── audit_log extra indexes ───────────────────────────────────────────────
create index if not exists audit_log_resource_idx
  on public.audit_log(resource_type, resource_id);

-- ─── campaign_pause_events ─────────────────────────────────────────────────
create table if not exists public.campaign_pause_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null check (action in ('pause','resume','stop')),
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists campaign_pause_events_campaign_idx
  on public.campaign_pause_events(campaign_id);
