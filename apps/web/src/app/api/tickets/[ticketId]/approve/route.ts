import { NextResponse } from "next/server";
import { getServiceSupabase, audit } from "@mailpilot/server-core";
import { resolveRequiredReviewers } from "@mailpilot/shared";
import { requireAuth } from "@/lib/auth";
import { ok, fail, failInternal, failNotFound } from "@/lib/api/responses";

export const dynamic = "force-dynamic";

async function loadOwnedTicket(ticketId: string, userId: string) {
  const sb = getServiceSupabase();
  const { data: ticket } = await sb.from("tickets").select("*").eq("id", ticketId).maybeSingle();
  if (!ticket) return null;
  const { data: campaign } = await sb.from("campaigns").select("owner_id").eq("id", ticket.campaign_id).maybeSingle();
  if (!campaign || campaign.owner_id !== userId) return null;
  return ticket;
}

/**
 * Per §2.3: zero reviews must NOT pass. We read campaign_settings.required_reviewers
 * (defaulting to the full 6-reviewer set if empty), require every one to have a
 * `pass` decision row for the current version, and reject otherwise.
 */
async function revalidate(ticketId: string, ticket: any): Promise<void> {
  const sb = getServiceSupabase();
  if (ticket.current_state !== "pending_approval" && ticket.current_state !== "approved" && ticket.current_state !== "ready_to_send") {
    throw new Error(`Cannot approve — ticket is in state ${ticket.current_state}`);
  }
  const { data: settings } = await sb.from("campaign_settings").select("approval").eq("campaign_id", ticket.campaign_id).maybeSingle();
  // Per §3 (4th-pass): use resolveRequiredReviewers so an empty array does
  // NOT collapse the six-reviewer pipeline.
  const required = resolveRequiredReviewers(
    (settings?.approval as { required_reviewers?: string[] })?.required_reviewers,
  );
  const { data: reviews } = await sb.from("ai_reviews").select("reviewer_role, decision, status").eq("ticket_id", ticketId).eq("email_version_id", ticket.current_email_version_id);
  const allReviews = reviews ?? [];

  // Per §2.3: zero reviews = NOT passing.
  if (allReviews.length === 0) {
    throw new Error("Cannot approve — no reviews have been recorded for this version");
  }
  for (const role of required) {
    const r = allReviews.find((x) => x.reviewer_role === role);
    if (!r) throw new Error(`Required review missing: ${role}`);
    if (r.status !== "completed") throw new Error(`Review ${role} is in status ${r.status}`);
    if (r.decision !== "pass") throw new Error(`Review ${role} did not pass (decision: ${r.decision})`);
  }
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ ticketId: string }> },
) {
  try {
    const { ticketId } = await ctx.params;
    const user = await requireAuth();
    const ticket = await loadOwnedTicket(ticketId, user.id);
    if (!ticket) return failNotFound("Ticket");
    await revalidate(ticketId, ticket);
    const sb = getServiceSupabase();
    // Per §5 (5th-pass): route through the state machine so workflow_events
    // gets the transition row and assertLegalTransition is enforced. The
    // previous version did raw SQL with a `.eq("current_state", "pending_approval")`
    // guard — race-safe but skipped the audit trail.
    const { transitionTicket } = await import("@mailpilot/server-core");
    try {
      await transitionTicket({
        ticket_id: ticketId,
        from: "pending_approval" as any,
        to: "approved" as any,
        actor_id: user.id,
      });
    } catch (e) {
      return fail("APPROVAL_FAILED", (e as Error).message, 400);
    }
    await sb.from("tickets").update({
      approval_status: "approved",
      updated_at: new Date().toISOString(),
    }).eq("id", ticketId);
    await sb.from("approval_events").insert({
      ticket_id: ticketId,
      actor_id: user.id,
      action: "approve",
      email_version_id: ticket.current_email_version_id,
    });
    await audit({
      actor_id: user.id,
      action: "ticket.approve",
      resource_type: "ticket",
      resource_id: ticketId,
      campaign_id: ticket.campaign_id,
      ticket_id: ticketId,
      metadata: {},
    });
    return ok({ approved: true });
  } catch (e) {
    return fail("APPROVAL_FAILED", (e as Error).message, 400);
  }
}
