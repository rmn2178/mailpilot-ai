import { NextResponse } from "next/server";
import { getServiceSupabase } from "@mailpilot/server-core";
import { requireAuth } from "@/lib/auth";
import { ok, fail, failInternal, failNotFound } from "@/lib/api/responses";
import { assertLegalTransition } from "@mailpilot/shared";

export const dynamic = "force-dynamic";

async function loadOwnedTicket(ticketId: string, userId: string) {
  const sb = getServiceSupabase();
  const { data: ticket } = await sb.from("tickets").select("*").eq("id", ticketId).maybeSingle();
  if (!ticket) return null;
  const { data: campaign } = await sb.from("campaigns").select("owner_id").eq("id", ticket.campaign_id).maybeSingle();
  if (!campaign || campaign.owner_id !== userId) return null;
  return ticket;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ ticketId: string }> },
) {
  try {
    const { ticketId } = await ctx.params;
    const user = await requireAuth();
    const ticket = await loadOwnedTicket(ticketId, user.id);
    if (!ticket) return failNotFound("Ticket");
    const sb = getServiceSupabase();
    const [{ data: versions }, { data: reviews }, { data: events }, { data: attachments }] = await Promise.all([
      sb.from("email_versions").select("*").eq("ticket_id", ticketId).order("version_number", { ascending: false }),
      sb.from("ai_reviews").select("*").eq("ticket_id", ticketId).order("started_at", { ascending: false }),
      sb.from("workflow_events").select("*").eq("ticket_id", ticketId).order("created_at", { ascending: false }).limit(50),
      sb.from("ticket_attachments").select("*").eq("ticket_id", ticketId),
    ]);
    return ok({ ticket, versions: versions ?? [], reviews: reviews ?? [], events: events ?? [], attachments: attachments ?? [] });
  } catch (e) {
    return failInternal((e as Error).message);
  }
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ ticketId: string }> },
) {
  try {
    const { ticketId } = await ctx.params;
    const user = await requireAuth();
    const ticket = await loadOwnedTicket(ticketId, user.id);
    if (!ticket) return failNotFound("Ticket");
    const body = await req.json();
    const sb = getServiceSupabase();

    // Per bug #2: approved/ready_to_send/gmail_draft_created cannot be edited
    // because there is no legal transition from those states to needs_attention
    // (approved → needs_attention is illegal; gmail_draft_created → needs_attention
    // IS legal but the user would lose the draft). The user must reject first.
    // Also, editing after approval invalidates the reviews that justified the
    // approval — the ticket would become unapprovable.
    const EDITABLE_STATES = new Set([
      "queued", "analyzing", "drafting", "humanizing", "grok_reviews",
      "gemini_qa", "quality_gate", "revising", "pending_approval",
      "needs_attention",
    ]);
    if (body.subject || body.body_plain) {
      if (!EDITABLE_STATES.has(ticket.current_state)) {
        return fail(
          "ILLEGAL_TRANSITION",
          `Cannot edit ticket in state ${ticket.current_state}. Approved/sent tickets are read-only. Reject the ticket first if you need to start over.`,
          400,
        );
      }
      // Create a new human-edited version
      const { data: latest } = await sb.from("email_versions").select("version_number").eq("ticket_id", ticketId).order("version_number", { ascending: false }).limit(1).maybeSingle();
      const next = (latest?.version_number ?? 0) + 1;
      const { data: v, error: vErr } = await sb.from("email_versions").insert({
        ticket_id: ticketId,
        version_number: next,
        subject: body.subject ?? "",
        body_plain: body.body_plain ?? "",
        body_html: body.body_html ?? null,
        source_references: [],
        attachment_manifest: [],
        created_by: "human",
      }).select("id").single();
      if (vErr || !v) throw new Error("Could not create email version");
      await sb.from("tickets").update({
        current_email_version_id: v.id,
        approval_status: "revision_requested",
        updated_at: new Date().toISOString(),
      }).eq("id", ticketId);
      // Per §2.14: invalidate reviews ONLY for the prior current version,
      // not historical versions. Reviews of historical versions are preserved
      // for the audit trail.
      if (ticket.current_email_version_id) {
        await sb.from("ai_reviews").delete()
          .eq("ticket_id", ticketId)
          .eq("email_version_id", ticket.current_email_version_id);
      }

      // Per §8 (4th-pass): a human-edited version has no reviews and is
      // therefore unapprovable. Transition to needs_attention with a clear
      // reason so the user sees the ticket requires action. The "Re-run
      // reviews" button on the ticket workspace re-enqueues the review
      // pipeline via POST /api/tickets/[ticketId]/revision.
      //
      // Per line-by-line audit: all EDITABLE_STATES can transition directly
      // to needs_attention (verified by pipeline-trace tests).
      try {
        const { transitionTicket } = await import("@mailpilot/server-core");
        await transitionTicket({
          ticket_id: ticketId,
          from: ticket.current_state as any,
          to: "needs_attention" as any,
          actor_id: user.id,
          reason: "Human-edited version requires re-review",
        });
        await sb.from("tickets").update({
          last_error: "Human-edited version requires re-review. Click 'Request revision' to re-run the review pipeline.",
          updated_at: new Date().toISOString(),
        }).eq("id", ticketId);
      } catch (e) {
        // If the transition was illegal (e.g. already in needs_attention),
        // still mark the ticket as needing attention via raw update.
        await sb.from("tickets").update({
          last_error: "Human-edited version requires re-review. Click 'Request revision' to re-run the review pipeline.",
          updated_at: new Date().toISOString(),
        }).eq("id", ticketId);
      }
    }

    return ok({ ok: true });
  } catch (e) {
    return failInternal((e as Error).message);
  }
}
