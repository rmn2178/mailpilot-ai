-- 0005_rls.sql — Row Level Security

-- MailPilot AI uses Supabase Auth. All application tables are owned by users
-- via the `owner_id` (campaigns, sender_accounts, suppression_list) or via
-- `campaign_id` (everything downstream of a campaign).
--
-- The worker uses the service-role key (bypasses RLS) but every privileged
-- operation MUST first verify campaign ownership in the service layer before
-- writing. RLS is the safety net, not the only check.

alter table public.profiles enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_settings enable row level security;
alter table public.imports enable row level security;
alter table public.import_rows enable row level security;
alter table public.contacts enable row level security;
alter table public.tickets enable row level security;
alter table public.email_versions enable row level security;
alter table public.ai_reviews enable row level security;
alter table public.workflow_events enable row level security;
alter table public.approval_events enable row level security;
alter table public.audit_log enable row level security;
alter table public.campaign_files enable row level security;
alter table public.ticket_attachments enable row level security;
alter table public.sender_accounts enable row level security;
alter table public.send_operations enable row level security;
alter table public.suppression_list enable row level security;
alter table public.usage_records enable row level security;
alter table public.review_runs enable row level security;
alter table public.revision_history enable row level security;
alter table public.campaign_pause_events enable row level security;

-- Direct ownership policies
create policy "profiles self read" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles self update" on public.profiles
  for update using (auth.uid() = id);

create policy "campaigns owner all" on public.campaigns
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "settings via campaign owner" on public.campaign_settings
  for all using (
    exists (select 1 from public.campaigns c
            where c.id = campaign_settings.campaign_id and c.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.campaigns c
            where c.id = campaign_settings.campaign_id and c.owner_id = auth.uid())
  );

create policy "imports via campaign owner" on public.imports
  for all using (
    exists (select 1 from public.campaigns c
            where c.id = imports.campaign_id and c.owner_id = auth.uid())
  );

create policy "import_rows via campaign owner" on public.import_rows
  for all using (
    exists (select 1 from public.imports i
            join public.campaigns c on c.id = i.campaign_id
            where i.id = import_rows.import_id and c.owner_id = auth.uid())
  );

create policy "contacts via campaign owner" on public.contacts
  for all using (
    exists (select 1 from public.campaigns c
            where c.id = contacts.campaign_id and c.owner_id = auth.uid())
  );

create policy "tickets via campaign owner" on public.tickets
  for all using (
    exists (select 1 from public.campaigns c
            where c.id = tickets.campaign_id and c.owner_id = auth.uid())
  );

create policy "email_versions via campaign owner" on public.email_versions
  for all using (
    exists (select 1 from public.tickets t
            join public.campaigns c on c.id = t.campaign_id
            where t.id = email_versions.ticket_id and c.owner_id = auth.uid())
  );

create policy "ai_reviews via campaign owner" on public.ai_reviews
  for all using (
    exists (select 1 from public.tickets t
            join public.campaigns c on c.id = t.campaign_id
            where t.id = ai_reviews.ticket_id and c.owner_id = auth.uid())
  );

create policy "workflow_events via campaign owner" on public.workflow_events
  for all using (
    campaign_id is null or exists (
      select 1 from public.campaigns c
      where c.id = workflow_events.campaign_id and c.owner_id = auth.uid()
    )
  );

create policy "approval_events via campaign owner" on public.approval_events
  for all using (
    exists (select 1 from public.tickets t
            join public.campaigns c on c.id = t.campaign_id
            where t.id = approval_events.ticket_id and c.owner_id = auth.uid())
  );

create policy "audit_log actor read" on public.audit_log
  for select using (auth.uid() = actor_id);

create policy "campaign_files via campaign owner" on public.campaign_files
  for all using (
    exists (select 1 from public.campaigns c
            where c.id = campaign_files.campaign_id and c.owner_id = auth.uid())
  );

create policy "ticket_attachments via campaign owner" on public.ticket_attachments
  for all using (
    exists (select 1 from public.tickets t
            join public.campaigns c on c.id = t.campaign_id
            where t.id = ticket_attachments.ticket_id and c.owner_id = auth.uid())
  );

create policy "sender_accounts owner all" on public.sender_accounts
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "send_operations via campaign owner" on public.send_operations
  for all using (
    exists (select 1 from public.tickets t
            join public.campaigns c on c.id = t.campaign_id
            where t.id = send_operations.ticket_id and c.owner_id = auth.uid())
  );

create policy "suppression_list owner all" on public.suppression_list
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "usage_records via campaign owner" on public.usage_records
  for select using (
    campaign_id is null or exists (
      select 1 from public.campaigns c
      where c.id = usage_records.campaign_id and c.owner_id = auth.uid()
    )
  );

create policy "review_runs via campaign owner" on public.review_runs
  for all using (
    exists (select 1 from public.tickets t
            join public.campaigns c on c.id = t.campaign_id
            where t.id = review_runs.ticket_id and c.owner_id = auth.uid())
  );

create policy "revision_history via campaign owner" on public.revision_history
  for all using (
    exists (select 1 from public.tickets t
            join public.campaigns c on c.id = t.campaign_id
            where t.id = revision_history.ticket_id and c.owner_id = auth.uid())
  );

create policy "campaign_pause_events via campaign owner" on public.campaign_pause_events
  for all using (
    exists (select 1 from public.campaigns c
            where c.id = campaign_pause_events.campaign_id and c.owner_id = auth.uid())
  );

-- provider_settings, prompt_versions, worker_heartbeat, global_settings
-- are admin-only. The web app reads them through a thin authenticated RPC
-- that runs with service-role and applies ownership checks. RLS is left off
-- for these because the worker (service-role) needs unrestricted access.
alter table public.provider_settings enable row level security;
alter table public.prompt_versions enable row level security;
alter table public.worker_heartbeat enable row level security;
alter table public.global_settings enable row level security;
-- No policies = no client access; only service-role can read/write.
