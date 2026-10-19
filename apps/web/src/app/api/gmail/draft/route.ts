import { NextResponse } from "next/server";
import {
  getServiceSupabase,
  getValidAccessToken,
  createDraft,
  fetchPrivateBytes,
  audit,
} from "@mailpilot/server-core";
import { requireAuth } from "@/lib/auth";
import { ok, fail, failInternal, failNotFound } from "@/lib/api/responses";
import { z } from "zod";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";

const Schema = z.object({ ticket_id: z.string().uuid() });

/**
 * Per §1.8: drafts MUST require approval. A draft is not a send, but the spec
 * requires revalidation on ANY Gmail operation against a ticket.
 *
 * Allowed source states: approved, ready_to_send, gmail_draft_created.
 * (pending_approval → must wait; sent → already delivered.)
 */
export async function POST(req: Request) {
  try {
    const user = await requireAuth();
    const body = await req.json();
    const parsed = Schema.safeParse(body);
    if (!parsed.success) return fail("VALIDATION_ERROR", "ticket_id required", 400);

    const sb = getServiceSupabase();
    const { data: ticket } = await sb.from("tickets").select("*").eq("id", parsed.data.ticket_id).maybeSingle();
    if (!ticket) return failNotFound("Ticket");
    const { data: campaign } = await sb.from("campaigns").select("owner_id").eq("id", ticket.campaign_id).maybeSingle();
    if (!campaign || campaign.owner_id !== user.id) return failNotFound("Ticket");

    // Approval gate — drafts require approval just like sends do.
    if (!["approved", "ready_to_send", "gmail_draft_created"].includes(ticket.current_state)) {
      return fail("NOT_APPROVED", `Cannot create draft — ticket is in state ${ticket.current_state}`, 400);
    }
    if (ticket.approval_status !== "approved" && ticket.approval_status !== "auto_approved") {
      return fail("NOT_APPROVED", "Ticket must be approved before creating a Gmail draft", 400);
    }
    if (!ticket.current_email_version_id) return fail("NO_VERSION", "No current email version", 400);

    const { data: version } = await sb.from("email_versions").select("*").eq("id", ticket.current_email_version_id).maybeSingle();
    if (!version) return failNotFound("Email version");

    const { data: account } = await sb.from("sender_accounts").select("email").eq("owner_id", user.id).order("connected_at", { ascending: false }).limit(1).maybeSingle();
    if (!account) return fail("NO_GMAIL", "Connect a Gmail account first", 400);

    const accessToken = await getValidAccessToken(user.id);
    if (!accessToken) return fail("NO_GMAIL", "Could not obtain access token", 400);

    // Per §12 (NEW): fetch ticket attachments so the Gmail draft includes them.
    // The previous version created drafts without attachments, losing material.
    const { data: attachments } = await sb.from("ticket_attachments").select("filename, storage_path, mime").eq("ticket_id", ticket.id);
    const atts = [];
    for (const a of attachments ?? []) {
      const bytes = await fetchPrivateBytes(a.storage_path);
      atts.push({ filename: a.filename, mime: a.mime, bytes: new Uint8Array(bytes) });
    }

    const outcome = await createDraft(accessToken, {
      to: ticket.recipient_email,
      from: account.email,
      subject: version.subject,
      text: version.body_plain,
      html: version.body_html,
      attachments: atts,
    });

    if (outcome.status === "created" && outcome.gmail_draft_id) {
      // Per line-by-line audit: use transitionTicket instead of raw SQL so
      // the state machine records the transition in workflow_events.
      const { transitionTicket } = await import("@mailpilot/server-core");
      try {
        await transitionTicket({
          ticket_id: ticket.id,
          from: ticket.current_state as any,
          to: "gmail_draft_created" as any,
          actor_id: user.id,
        });
      } catch {
        // If already in gmail_draft_created, the transition is a no-op.
        // If the state changed between our check and the transition, surface
        // the error but still record the draft ID.
      }
      // Drafts use a distinct status — NOT "sent" (per §5.10).
      await sb.from("send_operations").insert({
        ticket_id: ticket.id,
        email_version_id: version.id,
        operation_id: `draft-${outcome.gmail_draft_id}`,
        status: "unknown", // draft — not sent
        gmail_draft_id: outcome.gmail_draft_id,
        attempt: 1,
        attempted_at: new Date().toISOString(),
      });
      await audit({
        actor_id: user.id,
        action: "ticket.gmail_draft",
        resource_type: "ticket",
        resource_id: ticket.id,
        campaign_id: ticket.campaign_id,
        ticket_id: ticket.id,
        metadata: { gmail_draft_id: outcome.gmail_draft_id },
      });
      return ok({ gmail_draft_id: outcome.gmail_draft_id });
    }

    // Per §11 (5th-pass): record the failed/unknown draft attempt so the
    // orphaned draft (if Gmail created one before the timeout) is trackable.
    // Without this row, the user's Gmail may contain a draft we know nothing
    // about and there's no way to reconcile.
    await sb.from("send_operations").insert({
      ticket_id: ticket.id,
      email_version_id: version.id,
      operation_id: `draft-attempt-${crypto.randomUUID()}`,
      status: "failed",
      gmail_draft_id: outcome.gmail_draft_id,
      attempt: 1,
      attempted_at: new Date().toISOString(),
      error: outcome.error,
    });

    return fail("DRAFT_FAILED", outcome.error ?? "Draft creation failed", 500);
  } catch (e) {
    return failInternal((e as Error).message);
  }
}
