-- 0007_analysis_brief_and_cleanup.sql
-- Adds the analysis_brief column to tickets so the gemini_analyze output is
-- persisted and threaded through to gemini_generate and the reviewers.
-- Also drops dead tables left over from the early scaffold.

-- ─── Persisted analysis brief ───────────────────────────────────────────────
alter table public.tickets
  add column if not exists analysis_brief jsonb;

comment on column public.tickets.analysis_brief is
  'The structured brief produced by the gemini_analyze slot. Read by gemini_generate and the reviewers to ground their output.';

-- ─── Schema cleanup: drop dead tables ──────────────────────────────────────
-- These tables were created in early migrations but are never written by any
-- code path. They were superseded by the tables listed in the comment.

-- `files` (0001) was superseded by `campaign_files` (0002).
drop table if exists public.files cascade;

-- `send_events` (0001) was superseded by `send_operations` (0002).
drop table if exists public.send_events cascade;

-- `audit_events` (0001) was superseded by `audit_log` (0001). The audit_log
-- table is the one written by packages/server-core/src/audit.ts.
drop table if exists public.audit_events cascade;

-- `queue_job_locks` (0003) is unused — BullMQ's `jobId` parameter provides
-- the same idempotency guarantee without a separate DB table.
drop table if exists public.queue_job_locks cascade;

-- `review_runs` (0003) is unused — completion-tracker.ts does ad-hoc queries
-- against ai_reviews instead of grouping by run. Keep the table out of the
-- schema to avoid confusion.
drop table if exists public.review_runs cascade;

-- `revision_history` (0003) is unused. The from_version → to_version trail
-- is recorded in workflow_events.metadata. Drop the duplicate.
drop table if exists public.revision_history cascade;

-- ─── Remove unused columns from campaigns ──────────────────────────────────
-- `campaigns.auto_send_enabled` was declared but never written or read.
-- `campaigns.sending_mode` was written by POST /api/campaigns but read by
-- nothing — the campaign_settings.delivery.sending_mode JSON field is the
-- single source of truth. Drop both to consolidate per §14.
alter table public.campaigns
  drop column if exists auto_send_enabled,
  drop column if exists sending_mode;

-- ─── complete_send RPC ─────────────────────────────────────────────────────
-- Atomically updates send_operations AND transitions the ticket from
-- "sending" to its target state in a single transaction. Prevents the
-- divergence described in §10 where one write succeeds and the other fails.
create or replace function public.complete_send(
  p_ticket_id uuid,
  p_operation_id text,
  p_target_state text,
  p_gmail_message_id text default null,
  p_gmail_draft_id text default null,
  p_error text default null
) returns boolean language plpgsql security definer as $$
declare
  v_current text;
  v_op_updated boolean := false;
begin
  -- Update the send_operations row.
  update public.send_operations
    set status = p_target_state,
        gmail_message_id = coalesce(p_gmail_message_id, gmail_message_id),
        gmail_draft_id = coalesce(p_gmail_draft_id, gmail_draft_id),
        error = p_error,
        reconciled_at = case when p_target_state in ('sent','failed') then now() else reconciled_at end
    where operation_id = p_operation_id
    returning true into v_op_updated;

  if not v_op_updated then
    return false;
  end if;

  -- Transition the ticket from "sending" to p_target_state, if legal.
  select current_state into v_current from public.tickets where id = p_ticket_id;
  if v_current is null then
    return false;
  end if;

  if v_current = 'sending' then
    update public.tickets
      set current_state = p_target_state,
          last_error = case when p_target_state in ('send_status_unknown','needs_attention','failed') then p_error else last_error end,
          updated_at = now()
      where id = p_ticket_id and current_state = 'sending';

    insert into public.workflow_events (ticket_id, campaign_id, stage, event_type, metadata, error)
    select p_ticket_id, campaign_id, p_target_state, 'transition',
           jsonb_build_object('from', 'sending', 'to', p_target_state, 'operation_id', p_operation_id),
           p_error
    from public.tickets where id = p_ticket_id;
  end if;

  return true;
end$$;
