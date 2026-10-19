import { NextResponse } from "next/server";
import {
  getServiceSupabase,
  getValidAccessToken,
  sendEmail,
  audit,
  fetchPrivateBytes,
  recordWorkflowEvent,
} from "@mailpilot/server-core";
import { resolveRequiredReviewers } from "@mailpilot/shared";
import { requireAuth } from "@/lib/auth";
import { ok, fail, failInternal, failNotFound } from "@/lib/api/responses";
import { z } from "zod";

export const dynamic = "force-dynamic";

const Schema = z.object({ ticket_id: z.string().uuid() });

async function loadOwnedTicket(ticketId: string, userId: string) {
  const sb = getServiceSupabase();
  const { data: ticket } = await sb.from("tickets").select("*").eq("id", ticketId).maybeSingle();
  if (!ticket) return null;
  const { data: campaign } = await sb.from("campaigns").select("owner_id, status").eq("id", ticket.campaign_id).maybeSingle();
  if (!campaign || campaign.owner_id !== userId) return null;
  return { ticket, campaignStatus: campaign.status };
}

async function revalidateForSend(
  ticketId: string,
  userId: string,
): Promise<{ ticket: any; campaignStatus: string }> {
  const sb = getServiceSupabase();
  const loaded = await loadOwnedTicket(ticketId, userId);
  if (!loaded) throw new Error("Ticket not found or forbidden");
  const { ticket, campaignStatus } = loaded;
  if (campaignStatus === "paused") throw new Error("Campaign is paused");
  const { data: gs } = await sb.from("global_settings").select("value").eq("key", "global_send_switch").maybeSingle();
  // Per bug A: handle all possible stored forms.
  const gsRaw = gs?.value;
  if (gsRaw === true || gsRaw === "stopped" || gsRaw === '"stopped"') {
    throw new Error("Global send switch is stopped");
  }
  if (!["approved", "ready_to_send", "gmail_draft_created"].includes(ticket.current_state)) {
    throw new Error(`Cannot send — ticket is in state ${ticket.current_state}`);
  }
  if (!ticket.current_email_version_id) throw new Error("No current email version");
  const { data: reviews } = await sb.from("ai_reviews").select("reviewer_role, decision").eq("ticket_id", ticketId).eq("email_version_id", ticket.current_email_version_id);
  // Per §2.3: zero reviews must NOT pass. Empty required_reviewers also fails.
  const { data: settings } = await sb.from("campaign_settings").select("approval").eq("campaign_id", ticket.campaign_id).maybeSingle();
  // Per §3 (4th-pass): use resolveRequiredReviewers so an empty array does
  // NOT collapse the six-reviewer pipeline.
  const required = resolveRequiredReviewers(
    (settings?.approval as { required_reviewers?: string[] })?.required_reviewers,
  );
  for (const role of required) {
    const r = (reviews ?? []).find((x) => x.reviewer_role === role);
    if (!r) throw new Error(`Required review missing: ${role}`);
    if (r.decision !== "pass") throw new Error(`Review ${role} did not pass (decision: ${r.decision})`);
  }
  const { data: suppressed } = await sb.from("suppression_list").select("email").eq("email", ticket.recipient_email).maybeSingle();
  if (suppressed) throw new Error("Recipient is on suppression list");

  // Delivery caps
  const { data: fullSettings } = await sb.from("campaign_settings").select("delivery").eq("campaign_id", ticket.campaign_id).maybeSingle();
  const delivery = (fullSettings?.delivery ?? {}) as { max_per_hour?: number; max_per_day?: number; permitted_hours?: { start: number; end: number } };
  // Per bug D: use DEFAULT_TIMEZONE env var, not the server's local timezone.
  const { loadEnv } = await import("@mailpilot/server-core");
  const env = loadEnv();
  const tz = env.DEFAULT_TIMEZONE || "UTC";
  const now = new Date();
  const hourStr = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    hour12: false,
  }).format(now);
  const hour = parseInt(hourStr, 10);
  const permitted = delivery.permitted_hours ?? { start: 9, end: 18 };
  if (hour < permitted.start || hour >= permitted.end) {
    throw new Error(`Outside permitted sending hours (${permitted.start}:00–${permitted.end}:00 ${tz})`);
  }
  if (delivery.max_per_hour) {
    const { data: hourCount } = await sb.rpc("count_recent_sends", { p_campaign_id: ticket.campaign_id, p_window_seconds: 3600 });
    if ((hourCount ?? 0) >= delivery.max_per_hour) throw new Error("Campaign hour cap reached");
  }
  if (delivery.max_per_day) {
    const { data: dayCount } = await sb.rpc("count_recent_sends", { p_campaign_id: ticket.campaign_id, p_window_seconds: 86400 });
    if ((dayCount ?? 0) >= delivery.max_per_day) throw new Error("Campaign day cap reached");
  }

  return { ticket, campaignStatus };
}

export async function POST(req: Request) {
  try {
    const user = await requireAuth();
    const body = await req.json();
    const parsed = Schema.safeParse(body);
    if (!parsed.success) return fail("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid", 400);

    const { ticket } = await revalidateForSend(parsed.data.ticket_id, user.id);
    const sb = getServiceSupabase();
    const { data: version } = await sb.from("email_versions").select("*").eq("id", ticket.current_email_version_id).maybeSingle();
    if (!version) return failNotFound("Email version");
    const { data: account } = await sb.from("sender_accounts").select("email").eq("owner_id", user.id).order("connected_at", { ascending: false }).limit(1).maybeSingle();
    if (!account) return fail("NO_GMAIL", "Connect a Gmail account first", 400);

    const accessToken = await getValidAccessToken(user.id);
    if (!accessToken) return fail("NO_GMAIL", "Could not obtain a valid access token", 400);

    const { data: attachments } = await sb.from("ticket_attachments").select("filename, storage_path, mime").eq("ticket_id", ticket.id);
    const atts = [];
    for (const a of attachments ?? []) {
      const bytes = await fetchPrivateBytes(a.storage_path);
      atts.push({ filename: a.filename, mime: a.mime, bytes: new Uint8Array(bytes) });
    }

    // ─── Atomic reservation ──────────────────────────────────────────────
    // Deterministic operation_id so duplicate attempts collapse.
    const operationId = `${ticket.id}:${version.id}`;
    const { data: opId, error: reserveErr } = await sb.rpc("reserve_ticket_for_send", {
      p_ticket_id: ticket.id,
      p_email_version_id: version.id,
      p_operation_id: operationId,
    });
    if (reserveErr) throw new Error(`Reservation failed: ${reserveErr.message}`);
    if (!opId) {
      return fail("ALREADY_SENDING", "Ticket is already being sent or no longer in a send-ready state", 409);
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
    // tickets.current_state are updated in one transaction.
    let targetState: "sent" | "needs_attention" | "send_status_unknown";
    let gmailMessageId: string | null = null;
    if (outcome.status === "sent" && outcome.gmail_message_id) {
      targetState = "sent";
      gmailMessageId = outcome.gmail_message_id;
    } else if (outcome.status === "failed") {
      targetState = "needs_attention";
    } else {
      targetState = "send_status_unknown";
    }

    const { error: completeErr } = await sb.rpc("complete_send", {
      p_ticket_id: ticket.id,
      p_operation_id: operationId,
      p_target_state: targetState,
      p_gmail_message_id: gmailMessageId,
      p_error: outcome.error,
    });
    if (completeErr) {
      // Fallback: separate writes so BOTH the send_operations row AND the
      // ticket state get updated. The previous version only updated
      // send_operations, leaving the ticket stuck in 'sending' forever.
      console.error(`[send route] complete_send RPC failed for ${operationId}:`, completeErr.message);
      const sendOpStatus = targetState === "sent" ? "sent" : targetState === "needs_attention" ? "failed" : "unknown";
      try {
        await sb.from("send_operations").update({
          status: sendOpStatus,
          gmail_message_id: gmailMessageId,
          error: outcome.error,
          reconciled_at: targetState !== "send_status_unknown" ? new Date().toISOString() : null,
        }).eq("operation_id", operationId);
      } catch {
        // Best-effort — swallow.
      }
      // Per §14 (5th-pass): use transitionTicket so workflow_events gets
      // the transition row. The previous version did raw SQL.
      try {
        const { transitionTicket } = await import("@mailpilot/server-core");
        await transitionTicket({
          ticket_id: ticket.id,
          from: "sending",
          to: targetState,
          actor_id: user.id,
          reason: outcome.error ?? undefined,
        });
      } catch {
        // Best-effort — swallow.
      }
    }

    if (targetState === "send_status_unknown") {
      await recordWorkflowEvent({
        ticket_id: ticket.id,
        campaign_id: ticket.campaign_id,
        stage: "delivery",
        event_type: "send_unknown",
        metadata: { operation_id: operationId },
        error: outcome.error,
      });
    }

    await audit({
      actor_id: user.id,
      action: "ticket.send",
      resource_type: "ticket",
      resource_id: ticket.id,
      campaign_id: ticket.campaign_id,
      ticket_id: ticket.id,
      metadata: { operation_id: operationId, status: outcome.status, gmail_message_id: outcome.gmail_message_id },
    });

    return ok({
      operation_id: operationId,
      status: outcome.status,
      gmail_message_id: outcome.gmail_message_id,
      error: outcome.error,
    });
  } catch (e) {
    return fail("SEND_FAILED", (e as Error).message, 400);
  }
}
