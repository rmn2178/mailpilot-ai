import { NextResponse } from "next/server";
import { getServiceSupabase, audit, transitionTicket } from "@mailpilot/server-core";
import { REJECTABLE_SOURCES } from "@mailpilot/shared";
import { requireAuth } from "@/lib/auth";
import { ok, fail, failInternal, failNotFound } from "@/lib/api/responses";

export const dynamic = "force-dynamic";

/**
 * Reject — transitions to `cancelled` via the state machine.
 * Per §2.13: previously did a raw SQL update with no state check.
 *
 * Per §7 (5th-pass): the source list is exported from @mailpilot/shared so
 * the UI's "Reject" button can mirror it exactly.
 */
const REJECTABLE_SOURCES_SET: ReadonlySet<string> = new Set(REJECTABLE_SOURCES);

export async function POST(
  req: Request,
  ctx: { params: Promise<{ ticketId: string }> },
) {
  try {
    const { ticketId } = await ctx.params;
    const user = await requireAuth();
    const body = await req.json().catch(() => ({}));
    const reason = body.reason ?? null;
    const sb = getServiceSupabase();
    const { data: ticket } = await sb.from("tickets").select("*").eq("id", ticketId).maybeSingle();
    if (!ticket) return failNotFound("Ticket");
    const { data: campaign } = await sb.from("campaigns").select("owner_id").eq("id", ticket.campaign_id).maybeSingle();
    if (!campaign || campaign.owner_id !== user.id) return failNotFound("Ticket");

    const currentState = ticket.current_state as string;
    if (!REJECTABLE_SOURCES_SET.has(currentState)) {
      return fail("ILLEGAL_TRANSITION", `Cannot reject from state ${currentState}`, 400);
    }

    // Per pipeline verification: all REJECTABLE_SOURCES can transition directly
    // to "cancelled" per the state machine. The previous fallback through
    // needs_attention was buggy — it's illegal from `queued`, `approved`,
    // `paused`, `blocked`, `retry_scheduled`, and `failed`.
    try {
      await transitionTicket({
        ticket_id: ticketId,
        from: currentState as any,
        to: "cancelled" as any,
        actor_id: user.id,
        reason,
      });
    } catch (e) {
      // If the direct transition fails (e.g., race condition changed the
      // state between our check and the transition), surface the error.
      return fail("ILLEGAL_TRANSITION", `Could not reject from state ${currentState}: ${(e as Error).message}`, 400);
    }

    await sb.from("tickets").update({
      approval_status: "rejected",
      last_error: reason,
      updated_at: new Date().toISOString(),
    }).eq("id", ticketId);

    await sb.from("approval_events").insert({
      ticket_id: ticketId,
      actor_id: user.id,
      action: "reject",
      email_version_id: ticket.current_email_version_id,
      reason,
    });
    await audit({
      actor_id: user.id,
      action: "ticket.reject",
      resource_type: "ticket",
      resource_id: ticketId,
      campaign_id: ticket.campaign_id,
      ticket_id: ticketId,
      metadata: { reason },
    });
    return ok({ rejected: true });
  } catch (e) {
    return failInternal((e as Error).message);
  }
}
