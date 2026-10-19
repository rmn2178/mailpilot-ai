import { NextResponse } from "next/server";
import { getServiceSupabase, audit, validateFileIntent, uploadPrivate, buildStorageKey, transitionTicket } from "@mailpilot/server-core";
import { requireAuth } from "@/lib/auth";
import { ok, fail, failInternal, failNotFound, failForbidden } from "@/lib/api/responses";

export const dynamic = "force-dynamic";

async function loadOwnedTicket(ticketId: string, userId: string) {
  const sb = getServiceSupabase();
  const { data: ticket } = await sb.from("tickets").select("campaign_id, current_email_version_id, current_state").eq("id", ticketId).maybeSingle();
  if (!ticket) return null;
  const { data: campaign } = await sb.from("campaigns").select("owner_id").eq("id", ticket.campaign_id).maybeSingle();
  if (!campaign || campaign.owner_id !== userId) return null;
  return ticket as typeof ticket & { current_state: string };
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
    const { data: attachments } = await sb.from("ticket_attachments").select("*").eq("ticket_id", ticketId);
    return ok({ attachments: attachments ?? [] });
  } catch (e) {
    return failInternal((e as Error).message);
  }
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ ticketId: string }> },
) {
  try {
    const { ticketId } = await ctx.params;
    const user = await requireAuth();
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return fail("VALIDATION_ERROR", "file required", 400);
    const ticket = await loadOwnedTicket(ticketId, user.id);
    if (!ticket) return failNotFound("Ticket");

    // Per bug #2: refuse attachment changes on approved/sent tickets —
    // they invalidate reviews and the ticket can't transition to needs_attention.
    const ATTACHABLE_STATES = new Set([
      "queued", "analyzing", "drafting", "humanizing", "grok_reviews",
      "gemini_qa", "quality_gate", "revising", "pending_approval",
      "needs_attention",
    ]);
    if (!ATTACHABLE_STATES.has(ticket.current_state)) {
      return fail("ILLEGAL_TRANSITION", `Cannot add attachments in state ${ticket.current_state}. Reject the ticket first.`, 400);
    }

    const sb = getServiceSupabase();
    const bytes = new Uint8Array(await file.arrayBuffer());
    validateFileIntent(file.name, file.type || "application/octet-stream", bytes.byteLength);
    const path = buildStorageKey(`attachments/${ticketId}`, file.name);
    const up = await uploadPrivate(path, bytes, file.type || "application/octet-stream");

    const { data: att } = await sb.from("ticket_attachments").insert({
      ticket_id: ticketId,
      filename: file.name,
      storage_path: path,
      mime: up.mime,
      size_bytes: up.size,
      sha256: up.sha256,
    }).select("id").single();

    // Per §2.14: invalidate reviews for the CURRENT version only, not historical versions.
    if (ticket.current_email_version_id) {
      await sb.from("ai_reviews").delete().eq("ticket_id", ticketId).eq("email_version_id", ticket.current_email_version_id);
    }
    // If the ticket was already approved, revert to revision_requested so the
    // user can re-review. Use the state machine — illegal transitions are rejected.
    if (ticket.current_email_version_id) {
      // Reset approval_status; the user must re-approve after editing attachments.
      await sb.from("tickets").update({
        approval_status: "revision_requested",
        updated_at: new Date().toISOString(),
      }).eq("id", ticketId);
    }

    await audit({
      actor_id: user.id,
      action: "ticket.attachment.add",
      resource_type: "ticket",
      resource_id: ticketId,
      campaign_id: null,
      ticket_id: ticketId,
      metadata: { filename: file.name, size: up.size },
    });

    return ok({ id: att?.id });
  } catch (e) {
    return failInternal((e as Error).message);
  }
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ ticketId: string }> },
) {
  try {
    const { ticketId } = await ctx.params;
    const user = await requireAuth();
    const url = new URL(req.url);
    const attId = url.searchParams.get("id");
    if (!attId) return fail("VALIDATION_ERROR", "id required", 400);

    // Per §1.3: DELETE must check ownership.
    const ticket = await loadOwnedTicket(ticketId, user.id);
    if (!ticket) return failForbidden();

    // Per bug #2: refuse on approved/sent tickets.
    const ATTACHABLE_STATES = new Set([
      "queued", "analyzing", "drafting", "humanizing", "grok_reviews",
      "gemini_qa", "quality_gate", "revising", "pending_approval",
      "needs_attention",
    ]);
    if (!ATTACHABLE_STATES.has(ticket.current_state)) {
      return fail("ILLEGAL_TRANSITION", `Cannot remove attachments in state ${ticket.current_state}.`, 400);
    }

    const sb = getServiceSupabase();
    // Fetch the filename before deleting so we can audit it.
    const { data: attRow } = await sb.from("ticket_attachments").select("filename").eq("id", attId).eq("ticket_id", ticketId).maybeSingle();
    await sb.from("ticket_attachments").delete().eq("id", attId).eq("ticket_id", ticketId);
    // Invalidate reviews for the current version only (per §2.14).
    if (ticket.current_email_version_id) {
      await sb.from("ai_reviews").delete().eq("ticket_id", ticketId).eq("email_version_id", ticket.current_email_version_id);
      await sb.from("tickets").update({
        approval_status: "revision_requested",
        updated_at: new Date().toISOString(),
      }).eq("id", ticketId);
    }

    // Per bug #8: audit attachment DELETE (POST already audits).
    const { audit } = await import("@mailpilot/server-core");
    await audit({
      actor_id: user.id,
      action: "ticket.attachment.delete",
      resource_type: "ticket",
      resource_id: ticketId,
      campaign_id: null,
      ticket_id: ticketId,
      metadata: { filename: attRow?.filename ?? attId },
    });
    return ok({ deleted: true });
  } catch (e) {
    return failInternal((e as Error).message);
  }
}
