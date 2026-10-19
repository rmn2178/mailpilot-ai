import type { Job } from "bullmq";
import {
  getServiceSupabase,
  getValidAccessToken,
  sendEmail,
  fetchPrivateBytes,
  audit,
  recordWorkflowEvent,
} from "@mailpilot/server-core";

/**
 * Send processor — performs the actual Gmail API send for a ticket.
 *
 * Atomic reservation (per §2.5 and §16):
 *   1. Pre-validate approval, eligibility, suppression list, campaign pause,
 *      global send switch, sending caps.
 *   2. Call `reserve_ticket_for_send(ticketId, versionId, operationId)` —
 *      this atomically transitions ready_to_send|approved|gmail_draft_created
 *      → sending ONLY if the ticket is still in one of those states. If two
 *      callers race, only one wins.
 *   3. The operation_id is deterministic: `${ticketId}:${versionId}` so a
 *      retry re-uses the same row.
 *   4. Call Gmail. If we time out, mark `send_status_unknown` and require
 *      reconciliation. Never blindly retry.
 */
export async function processSend(job: Job<{ ticketId: string; ownerId: string; auto?: boolean }>): Promise<void> {
  const { ticketId, ownerId, auto } = job.data;
  const sb = getServiceSupabase();

  const { data: ticket } = await sb.from("tickets").select("*").eq("id", ticketId).maybeSingle();
  if (!ticket) throw new Error(`Ticket ${ticketId} not found`);
  const { data: campaign } = await sb.from("campaigns").select("*").eq("id", ticket.campaign_id).maybeSingle();
  if (!campaign) throw new Error("Campaign missing");
  if (campaign.status === "paused") throw new Error("Campaign paused");

  const { data: gs } = await sb.from("global_settings").select("value").eq("key", "global_send_switch").maybeSingle();
  // Per bug A: handle all possible stored forms — boolean true, string "stopped",
  // or the legacy quoted-string form.
  const gsRaw = gs?.value;
  if (gsRaw === true || gsRaw === "stopped" || gsRaw === '"stopped"') {
    throw new Error("Global send switch is stopped");
  }

  // Per §14 (NEW): if this is an auto-send job, verify the campaign still has
  // auto_send enabled. Defense in depth — the flag may have been disabled
  // between the orchestrator enqueueing the job and the worker picking it up.
  if (auto) {
    const { data: settings } = await sb.from("campaign_settings").select("approval").eq("campaign_id", ticket.campaign_id).maybeSingle();
    const autoSend = (settings?.approval as { auto_send?: boolean } | null)?.auto_send === true;
    if (!autoSend) {
      throw new Error("Auto-send job received but campaign no longer has auto_send enabled — refusing");
    }
  }

  if (!["approved", "ready_to_send", "gmail_draft_created"].includes(ticket.current_state)) {
    throw new Error(`Ticket not in send-ready state: ${ticket.current_state}`);
  }
  if (!ticket.current_email_version_id) throw new Error("No current email version");

  const { data: suppressed } = await sb.from("suppression_list").select("email").eq("email", ticket.recipient_email).maybeSingle();
  if (suppressed) throw new Error("Recipient on suppression list");

  const { data: version } = await sb.from("email_versions").select("*").eq("id", ticket.current_email_version_id).maybeSingle();
  if (!version) throw new Error("Version missing");

  // Delivery caps check — per §5.11
  const { data: settings } = await sb.from("campaign_settings").select("delivery").eq("campaign_id", ticket.campaign_id).maybeSingle();
  const delivery = (settings?.delivery ?? {}) as { max_per_hour?: number; max_per_day?: number; permitted_hours?: { start: number; end: number } };
  // Per bug D: use DEFAULT_TIMEZONE env var (or a per-campaign timezone if
  // configured) to determine the current hour. The previous version used the
  // server's local timezone, which is wrong on UTC-hosted workers.
  const { loadEnv } = await import("@mailpilot/server-core");
  const env = loadEnv();
  const tz = env.DEFAULT_TIMEZONE || "UTC";
  const now = new Date();
  // Use Intl.DateTimeFormat to get the hour in the target timezone.
  const hourStr = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    hour12: false,
  }).format(now);
  const hour = parseInt(hourStr, 10);
  const permitted = delivery.permitted_hours ?? { start: 9, end: 18 };
  if (hour < permitted.start || hour >= permitted.end) {
    // Per pipeline verification: outside permitted hours should DELAY the
    // send, not fail it. Re-enqueue the job with a BullMQ delay until the
    // next permitted window. The ticket stays in its send-ready state.
    const next = new Date(now);
    if (hour >= permitted.end) {
      next.setDate(next.getDate() + 1);
    }
    next.setHours(permitted.start, 0, 0, 0);
    const delayMs = Math.max(60_000, next.getTime() - now.getTime());
    const { getQueue, QUEUE_NAMES } = await import("@mailpilot/server-core");
    const q = getQueue(QUEUE_NAMES.delivery);
    await q.add(
      "send",
      { ticketId, ownerId, auto },
      { delay: delayMs, jobId: `send-delayed-${ticketId}-${Date.now()}` },
    );
    console.log(`[send] ticket ${ticketId} outside permitted hours; delayed ${Math.round(delayMs / 1000 / 60)}min until ${next.toISOString()}`);
    return; // Job "succeeds" — the delayed re-enqueue will handle the actual send.
  }
  if (delivery.max_per_hour) {
    const { data: hourCount } = await sb.rpc("count_recent_sends", { p_campaign_id: ticket.campaign_id, p_window_seconds: 3600 });
    if ((hourCount ?? 0) >= delivery.max_per_hour) {
      throw new Error(`Campaign hour cap reached (${delivery.max_per_hour}/hour)`);
    }
  }
  if (delivery.max_per_day) {
    const { data: dayCount } = await sb.rpc("count_recent_sends", { p_campaign_id: ticket.campaign_id, p_window_seconds: 86400 });
    if ((dayCount ?? 0) >= delivery.max_per_day) {
      throw new Error(`Campaign day cap reached (${delivery.max_per_day}/day)`);
    }
  }

  const accessToken = await getValidAccessToken(ownerId);
  if (!accessToken) throw new Error("No valid Gmail access token");

  const { data: account } = await sb.from("sender_accounts").select("email").eq("owner_id", ownerId).order("connected_at", { ascending: false }).limit(1).maybeSingle();
  if (!account) throw new Error("No sender account");

  const { data: attachments } = await sb.from("ticket_attachments").select("filename, storage_path, mime").eq("ticket_id", ticketId);
  const atts = [];
  for (const a of attachments ?? []) {
    const bytes = await fetchPrivateBytes(a.storage_path);
    atts.push({ filename: a.filename, mime: a.mime, bytes: new Uint8Array(bytes) });
  }

  // ─── Atomic reservation ────────────────────────────────────────────────
  // The operation_id is deterministic — `${ticketId}:${versionId}` — so a
  // retry re-uses the same send_operations row. Two simultaneous attempts
  // race on the same ticket state; only one wins the transition.
  const operationId = `${ticketId}:${version.id}`;
  const { data: opId, error: reserveErr } = await sb.rpc("reserve_ticket_for_send", {
    p_ticket_id: ticketId,
    p_email_version_id: version.id,
    p_operation_id: operationId,
  });
  if (reserveErr) throw new Error(`Reservation failed: ${reserveErr.message}`);
  if (!opId) {
    // Someone else already transitioned this ticket out of the send-ready
    // states. Either a duplicate job or a state change. No-op.
    return;
  }

  const outcome = await sendEmail(accessToken, {
    to: ticket.recipient_email,
    from: account.email,
    subject: version.subject,
    text: version.body_plain,
    html: version.body_html,
    attachments: atts,
  });

  // Per §10 (NEW): use the atomic complete_send RPC so send_operations and
  // tickets.current_state are updated in one transaction. Prevents the
  // divergence where one write succeeds and the other fails.
  let targetState: "sent" | "needs_attention" | "send_status_unknown";
  let gmailMessageId: string | null = null;
  if (outcome.status === "sent" && outcome.gmail_message_id) {
    targetState = "sent";
    gmailMessageId = outcome.gmail_message_id;
  } else if (outcome.status === "failed") {
    // 4xx — definitive failure. Manual intervention required.
    targetState = "needs_attention";
  } else {
    // network or 5xx — outcome uncertain, requires reconciliation.
    targetState = "send_status_unknown";
  }

  const { error: completeErr } = await sb.rpc("complete_send", {
    p_ticket_id: ticketId,
    p_operation_id: operationId,
    p_target_state: targetState,
    p_gmail_message_id: gmailMessageId,
    p_error: outcome.error,
  });
  if (completeErr) {
    // The RPC failed entirely — fall back to separate writes so BOTH the
    // send_operations row AND the ticket state get updated. The previous
    // version only updated send_operations, leaving the ticket stuck in
    // 'sending' forever.
    console.error(`[send] complete_send RPC failed for ${operationId}:`, completeErr.message);
    const sendOpStatus = targetState === "sent" ? "sent" : targetState === "needs_attention" ? "failed" : "unknown";
    try {
      await sb.from("send_operations").update({
        status: sendOpStatus,
        gmail_message_id: gmailMessageId,
        error: outcome.error,
        reconciled_at: targetState !== "send_status_unknown" ? new Date().toISOString() : null,
      }).eq("operation_id", operationId);
    } catch {
      // Best-effort fallback.
    }
    // Per §14 (5th-pass): use transitionTicket so the state machine records
    // the transition in workflow_events and asserts legality. The previous
    // version did raw SQL — race-safe but skipped the audit trail.
    try {
      const { transitionTicket } = await import("@mailpilot/server-core");
      await transitionTicket({
        ticket_id: ticketId,
        from: "sending",
        to: targetState,
        actor_id: null,
        reason: outcome.error ?? undefined,
      });
    } catch {
      // Best-effort — swallow.
    }
  }

  if (targetState === "send_status_unknown") {
    await recordWorkflowEvent({
      ticket_id: ticketId,
      campaign_id: ticket.campaign_id,
      stage: "delivery",
      event_type: "send_unknown",
      metadata: { operation_id: operationId },
      error: outcome.error,
    });
  }

  await audit({
    actor_id: null,
    action: "ticket.send_attempt",
    resource_type: "ticket",
    resource_id: ticketId,
    campaign_id: ticket.campaign_id,
    ticket_id: ticketId,
    metadata: { operation_id: operationId, status: outcome.status, gmail_message_id: outcome.gmail_message_id },
  });
}
