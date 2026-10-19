import { NextResponse } from "next/server";
import { getServiceSupabase, audit, transitionTicket, enqueueIdempotent, QUEUE_NAMES } from "@mailpilot/server-core";
import { ALLOWED_REVISION_SOURCES } from "@mailpilot/shared";
import { requireAuth } from "@/lib/auth";
import { ok, fail, failInternal, failNotFound } from "@/lib/api/responses";

export const dynamic = "force-dynamic";

/**
 * Revision request — transitions the ticket to `revising` via the state
 * machine. Per §2.13: previously did a raw SQL update with no state check,
 * which let a user reopen a `sent` ticket.
 *
 * Legal source states for `revising` (per transitions.ts):
 *   quality_gate → revising
 * (The worker's revise processor also handles `revising` directly.)
 *
 * From any other state, we reject.
 *
 * Per §7 (5th-pass): the source list is exported from @mailpilot/shared so
 * the UI's "Request revision" button can mirror it exactly — otherwise the
 * button gets enabled for states the API will reject with 400.
 */
const ALLOWED_REVISION_SOURCES_SET: ReadonlySet<string> = new Set(ALLOWED_REVISION_SOURCES);

export async function POST(
  req: Request,
  ctx: { params: Promise<{ ticketId: string }> },
) {
  try {
    const { ticketId } = await ctx.params;
    const user = await requireAuth();
    const body = await req.json().catch(() => ({}));
    const reason = body.reason ?? "User requested revision";
    const sb = getServiceSupabase();
    const { data: ticket } = await sb.from("tickets").select("*").eq("id", ticketId).maybeSingle();
    if (!ticket) return failNotFound("Ticket");
    const { data: campaign } = await sb.from("campaigns").select("owner_id").eq("id", ticket.campaign_id).maybeSingle();
    if (!campaign || campaign.owner_id !== user.id) return failNotFound("Ticket");

    if (!ALLOWED_REVISION_SOURCES_SET.has(ticket.current_state)) {
      return fail(
        "ILLEGAL_TRANSITION",
        `Cannot request revision from state ${ticket.current_state}. Allowed: ${ALLOWED_REVISION_SOURCES.join(", ")}`,
        400,
      );
    }

    // Use the state machine — throws on illegal transition.
    // If pending_approval, we need to go through quality_gate first.
    if (ticket.current_state === "pending_approval") {
      await transitionTicket({
        ticket_id: ticketId,
        from: "pending_approval",
        to: "needs_attention",
        actor_id: user.id,
        reason,
      });
      await transitionTicket({
        ticket_id: ticketId,
        from: "needs_attention",
        to: "revising",
        actor_id: user.id,
        reason,
      });
    } else if (ticket.current_state === "needs_attention") {
      await transitionTicket({
        ticket_id: ticketId,
        from: "needs_attention",
        to: "revising",
        actor_id: user.id,
        reason,
      });
    } else {
      // quality_gate → revising
      await transitionTicket({
        ticket_id: ticketId,
        from: "quality_gate",
        to: "revising",
        actor_id: user.id,
        reason,
      });
    }

    await sb.from("tickets").update({
      approval_status: "revision_requested",
      updated_at: new Date().toISOString(),
    }).eq("id", ticketId);

    await sb.from("approval_events").insert({
      ticket_id: ticketId,
      actor_id: user.id,
      action: "revision_request",
      email_version_id: ticket.current_email_version_id,
      reason,
    });
    await audit({
      actor_id: user.id,
      action: "ticket.revision_request",
      resource_type: "ticket",
      resource_id: ticketId,
      campaign_id: ticket.campaign_id,
      ticket_id: ticketId,
      metadata: { reason },
    });

    // Enqueue the revision job so the worker picks it up.
    await enqueueIdempotent(QUEUE_NAMES.revisions, "revise", { ticketId }, `revise-${ticketId}-${Date.now()}`);

    return ok({ revision_requested: true });
  } catch (e) {
    return failInternal((e as Error).message);
  }
}
