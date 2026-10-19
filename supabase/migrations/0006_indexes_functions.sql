-- 0006_indexes_functions.sql — composite indexes & helper functions

-- ─── Composite indexes for the dashboard ───────────────────────────────────
create index if not exists tickets_campaign_state_idx
  on public.tickets(campaign_id, current_state);
create index if not exists tickets_state_updated_idx
  on public.tickets(current_state, updated_at desc);
create index if not exists ai_reviews_version_role_idx
  on public.ai_reviews(email_version_id, reviewer_role);
create index if not exists workflow_events_ticket_created_idx
  on public.workflow_events(ticket_id, created_at desc);

-- ─── auto_create_profile ───────────────────────────────────────────────────
-- Trigger: when a new auth.users row is created, mirror it into public.profiles.
create or replace function public.auto_create_profile()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, display_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', null), 'member')
  on conflict (id) do nothing;
  return new;
end$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.auto_create_profile();

-- ─── promote_first_admin ───────────────────────────────────────────────────
-- The first user to sign up becomes the admin. Subsequent sign-ups are members.
-- Called by the auth trigger above.
create or replace function public.promote_first_admin()
returns trigger language plpgsql security definer as $$
declare v_count int;
begin
  select count(*) into v_count from public.profiles;
  if v_count = 1 then
    update public.profiles set role = 'admin' where id = new.id;
  end if;
  return new;
end$$;

drop trigger if exists on_profile_created_promote_admin on public.profiles;
create trigger on_profile_created_promote_admin
  after insert on public.profiles
  for each row execute function public.promote_first_admin();

-- ─── atomic_transition helper ──────────────────────────────────────────────
-- Atomically transitions a ticket if (and only if) its current_state equals
-- the expected `from` value. Returns the new state on success, NULL on
-- failure (optimistic-concurrency mismatch). This is what the worker uses
-- to prevent lost updates when multiple queue jobs touch the same ticket.
create or replace function public.atomic_transition_ticket(
  p_ticket_id uuid,
  p_from text,
  p_to text,
  p_reason text default null
) returns text language plpgsql security definer as $$
declare
  v_campaign_id uuid;
  v_new_state text;
begin
  update public.tickets
    set current_state = p_to,
        last_error = case when p_to = 'failed' then p_reason else last_error end,
        updated_at = now()
    where id = p_ticket_id and current_state = p_from
    returning campaign_id, current_state into v_campaign_id, v_new_state;
  if v_new_state is null then
    return null;
  end if;
  insert into public.workflow_events (ticket_id, campaign_id, stage, event_type, metadata, error)
  values (p_ticket_id, v_campaign_id, p_to, 'transition',
          jsonb_build_object('from', p_from, 'to', p_to, 'reason', p_reason), null);
  return v_new_state;
end$$;

-- ─── increment_revision_attempts ───────────────────────────────────────────
create or replace function public.increment_revision_attempts(p_ticket_id uuid)
returns int language plpgsql security definer as $$
declare v_attempts int;
begin
  update public.tickets
    set revision_attempts = revision_attempts + 1, updated_at = now()
    where id = p_ticket_id
    returning revision_attempts into v_attempts;
  return v_attempts;
end$$;

-- ─── bump_settings_version ─────────────────────────────────────────────────
-- Updates the campaign AND its settings row atomically.
create or replace function public.bump_settings_version(p_campaign_id uuid)
returns int language plpgsql security definer as $$
declare v_version int;
begin
  update public.campaigns
    set settings_version = settings_version + 1, updated_at = now()
    where id = p_campaign_id
    returning settings_version into v_version;
  update public.campaign_settings
    set settings_version = v_version, updated_at = now()
    where campaign_id = p_campaign_id;
  return v_version;
end$$;

-- ─── update_campaign_settings (transactional) ─────────────────────────────
-- Updates writing/approval/delivery/revision JSON in one transaction with the
-- version bump. Fixes the §4.2 write-consistency bug.
create or replace function public.update_campaign_settings(
  p_campaign_id uuid,
  p_writing jsonb,
  p_approval jsonb,
  p_delivery jsonb,
  p_revision jsonb
) returns int language plpgsql security definer as $$
declare v_version int;
begin
  update public.campaign_settings
    set writing = p_writing,
        approval = p_approval,
        delivery = p_delivery,
        revision = p_revision,
        updated_at = now()
    where campaign_id = p_campaign_id;
  update public.campaigns
    set settings_version = settings_version + 1, updated_at = now()
    where id = p_campaign_id
    returning settings_version into v_version;
  update public.campaign_settings
    set settings_version = v_version
    where campaign_id = p_campaign_id;
  return v_version;
end$$;

-- ─── reservation_send ──────────────────────────────────────────────────────
-- Atomically reserves a ticket for sending by transitioning
-- ready_to_send|approved|gmail_draft_created → sending ONLY IF the ticket is
-- still in one of those states. Returns the new send operation row id, or NULL
-- if the reservation failed (someone else got there first).
create or replace function public.reserve_ticket_for_send(
  p_ticket_id uuid,
  p_email_version_id uuid,
  p_operation_id text
) returns uuid language plpgsql security definer as $$
declare
  v_new_state text;
  v_op_id uuid;
begin
  -- Try the atomic transition. Only one caller can win.
  update public.tickets
    set current_state = 'sending', updated_at = now()
    where id = p_ticket_id
      and current_state in ('ready_to_send','approved','gmail_draft_created')
    returning id into v_new_state;
  if v_new_state is null then
    return null;
  end if;
  insert into public.send_operations (ticket_id, email_version_id, operation_id, status, attempt, attempted_at)
  values (p_ticket_id, p_email_version_id, p_operation_id, 'sending', 1, now())
  returning id into v_op_id;
  return v_op_id;
end$$;

-- ─── dashboard_counts helper ───────────────────────────────────────────────
-- Aggregates ticket counts by state class for a given owner.
create or replace function public.dashboard_counts_for_owner(p_owner_id uuid)
returns table (
  recipients_imported bigint,
  emails_processing bigint,
  waiting_for_approval bigint,
  approved_ready_to_send bigint,
  sent bigint,
  failed_or_needs_attention bigint
) language plpgsql security definer as $$
begin
  return query
    select
      (select count(*) from public.contacts c
         join public.campaigns cmp on cmp.id = c.campaign_id
         where cmp.owner_id = p_owner_id),
      (select count(*) from public.tickets t
         join public.campaigns cmp on cmp.id = t.campaign_id
         where cmp.owner_id = p_owner_id
           and t.current_state in ('analyzing','drafting','humanizing',
              'grok_reviews','gemini_qa','quality_gate','revising','sending')),
      (select count(*) from public.tickets t
         join public.campaigns cmp on cmp.id = t.campaign_id
         where cmp.owner_id = p_owner_id
           and t.current_state = 'pending_approval'),
      (select count(*) from public.tickets t
         join public.campaigns cmp on cmp.id = t.campaign_id
         where cmp.owner_id = p_owner_id
           and t.current_state in ('approved','ready_to_send','gmail_draft_created')),
      (select count(*) from public.tickets t
         join public.campaigns cmp on cmp.id = t.campaign_id
         where cmp.owner_id = p_owner_id
           and t.current_state = 'sent'),
      (select count(*) from public.tickets t
         join public.campaigns cmp on cmp.id = t.campaign_id
         where cmp.owner_id = p_owner_id
           and t.current_state in ('needs_attention','blocked','failed','send_status_unknown'));
end$$;

-- ─── count_recent_sends ────────────────────────────────────────────────────
-- Used by the send path to enforce campaign delivery caps (max_per_hour,
-- max_per_day). Returns counts of successful sends for a campaign within
-- the given lookback window.
create or replace function public.count_recent_sends(
  p_campaign_id uuid,
  p_window_seconds int
) returns bigint language plpgsql security definer as $$
declare v_count bigint;
begin
  select count(*) into v_count
  from public.send_operations so
  join public.tickets t on t.id = so.ticket_id
  where t.campaign_id = p_campaign_id
    and so.status = 'sent'
    and so.attempted_at > now() - (p_window_seconds || ' seconds')::interval;
  return v_count;
end$$;
