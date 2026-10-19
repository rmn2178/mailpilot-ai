-- 0010_disable_rls_service_role.sql
-- MailPilot now uses a single hardcoded admin session (cookie-based auth)
-- instead of Supabase Auth. All API routes and the worker use the service-role
-- key which bypasses RLS by default, but we explicitly disable RLS and grant
-- full access so that any client-side Supabase calls also work cleanly.
--
-- Security is enforced at the application layer (requireAuth in middleware +
-- API routes) rather than at the DB layer.

-- ─── Disable RLS on all tables ─────────────────────────────────────────────
alter table public.profiles                disable row level security;
alter table public.campaigns               disable row level security;
alter table public.campaign_settings       disable row level security;
alter table public.imports                 disable row level security;
alter table public.import_rows             disable row level security;
alter table public.contacts                disable row level security;
alter table public.tickets                 disable row level security;
alter table public.email_versions          disable row level security;
alter table public.ai_reviews              disable row level security;
alter table public.workflow_events         disable row level security;
alter table public.approval_events         disable row level security;
alter table public.audit_log               disable row level security;
alter table public.campaign_files          disable row level security;
alter table public.ticket_attachments      disable row level security;
alter table public.sender_accounts         disable row level security;
alter table public.send_operations         disable row level security;
alter table public.suppression_list        disable row level security;
alter table public.usage_records           disable row level security;
alter table public.campaign_pause_events   disable row level security;
-- review_runs and revision_history were dropped in 0007, skip them.
alter table public.provider_settings       disable row level security;
alter table public.prompt_versions         disable row level security;
alter table public.worker_heartbeat        disable row level security;
alter table public.global_settings         disable row level security;
alter table public.send_reconciliation     disable row level security;

-- ─── Drop all existing RLS policies (clean slate) ──────────────────────────
drop policy if exists "profiles self read"                    on public.profiles;
drop policy if exists "profiles self update"                  on public.profiles;
drop policy if exists "campaigns owner all"                   on public.campaigns;
drop policy if exists "settings via campaign owner"           on public.campaign_settings;
drop policy if exists "imports via campaign owner"            on public.imports;
drop policy if exists "import_rows via campaign owner"        on public.import_rows;
drop policy if exists "contacts via campaign owner"           on public.contacts;
drop policy if exists "tickets via campaign owner"            on public.tickets;
drop policy if exists "email_versions via campaign owner"     on public.email_versions;
drop policy if exists "ai_reviews via campaign owner"         on public.ai_reviews;
drop policy if exists "workflow_events via campaign owner"    on public.workflow_events;
drop policy if exists "approval_events via campaign owner"    on public.approval_events;
drop policy if exists "audit_log actor read"                  on public.audit_log;
drop policy if exists "campaign_files via campaign owner"     on public.campaign_files;
drop policy if exists "ticket_attachments via campaign owner" on public.ticket_attachments;
drop policy if exists "sender_accounts owner all"             on public.sender_accounts;
drop policy if exists "send_operations via campaign owner"    on public.send_operations;
drop policy if exists "suppression_list owner all"            on public.suppression_list;
drop policy if exists "usage_records via campaign owner"      on public.usage_records;
-- review_runs and revision_history were dropped in 0007, skip their policies.
drop policy if exists "campaign_pause_events via campaign owner" on public.campaign_pause_events;

-- ─── Grant full access to service_role and authenticated roles ─────────────
do $$
declare
  tbl text;
  tables text[] := array[
    'profiles','campaigns','campaign_settings','imports','import_rows',
    'contacts','tickets','email_versions','ai_reviews','workflow_events',
    'approval_events','audit_log','campaign_files','ticket_attachments',
    'sender_accounts','send_operations','suppression_list','usage_records',
    'campaign_pause_events','provider_settings','prompt_versions',
    'worker_heartbeat','global_settings','send_reconciliation'
  ];
begin
  foreach tbl in array tables loop
    execute format(
      'grant select, insert, update, delete on public.%I to service_role, authenticated, anon;',
      tbl
    );
  end loop;
end$$;

-- ─── Insert a fixed admin profile row ──────────────────────────────────────
-- Since we no longer use Supabase Auth, there is no auth.users row to
-- satisfy the FK on profiles(id). We drop the FK constraint and insert a
-- stable admin profile that all owner_id references will point to.
alter table public.profiles
  drop constraint if exists profiles_id_fkey;

-- Use a fixed, well-known UUID for the single admin user.
insert into public.profiles (id, email, display_name, role)
values (
  '00000000-0000-0000-0000-000000000001',
  'admin@mailpilot.ai',
  'Admin',
  'admin'
)
on conflict (id) do update
  set email = excluded.email,
      role  = excluded.role;
