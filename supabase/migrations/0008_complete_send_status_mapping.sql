-- 0008_complete_send_status_mapping.sql
-- Fixes the critical bug introduced in 0007 where complete_send passed
-- p_target_state directly to send_operations.status. The CHECK constraint
-- on send_operations allows only ('queued','sending','sent','failed','unknown','reconciling'),
-- but the callers pass ticket states ('needs_attention', 'send_status_unknown').
-- This caused the entire transaction to roll back, leaving tickets stuck in 'sending'.

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
  v_send_status text;
begin
  -- Map ticket state to the constrained send_operations.status enum.
  -- send_operations.status CHECK: ('queued','sending','sent','failed','unknown','reconciling')
  v_send_status := case p_target_state
    when 'sent'                then 'sent'
    when 'needs_attention'     then 'failed'
    when 'send_status_unknown' then 'unknown'
    when 'failed'              then 'failed'
    else 'failed'
  end;

  -- Update the send_operations row with the mapped status.
  update public.send_operations
    set status = v_send_status,
        gmail_message_id = coalesce(p_gmail_message_id, gmail_message_id),
        gmail_draft_id = coalesce(p_gmail_draft_id, gmail_draft_id),
        error = p_error,
        reconciled_at = case when p_target_state in ('sent','needs_attention','failed') then now() else reconciled_at end
    where operation_id = p_operation_id
    returning true into v_op_updated;

  if not v_op_updated then
    return false;
  end if;

  -- Transition the ticket from 'sending' to p_target_state, if legal.
  -- p_target_state is a TicketState value (sent, needs_attention, send_status_unknown, failed).
  select current_state into v_current from public.tickets where id = p_ticket_id;
  if v_current is null then
    return false;
  end if;

  if v_current = 'sending' then
    -- Per pipeline verification: only allow legal transitions from 'sending'.
    -- The state machine allows: sending → sent, send_status_unknown, failed, needs_attention.
    if p_target_state not in ('sent', 'send_status_unknown', 'failed', 'needs_attention') then
      -- Illegal target — abort without updating the ticket.
      return false;
    end if;
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
