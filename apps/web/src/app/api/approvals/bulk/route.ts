import { NextResponse } from "next/server";
import { getServiceSupabase, audit, transitionTicket } from "@mailpilot/server-core";
import { resolveRequiredReviewers, REJECTABLE_SOURCES } from "@mailpilot/shared";
import { requireAuth } from "@/lib/auth";
import { ok, fail, failInternal } from "@/lib/api/responses";
import { z } from "zod";

export const dynamic = "force-dynamic";

const Schema = z.object({
  ticket_ids: z.array(z.string().uuid()).min(1),
  action: z.enum(["approve", "reject"]),
});

export async function POST(req: Request) {
  try {
    const user = await requireAuth();
    const body = await req.json();
    const parsed = Schema.safeParse(body);
    if (!parsed.success) return fail("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid", 400);

    const sb = getServiceSupabase();
    const approved: string[] = [];
    const blocked: Array<{ id: string; reason: string }> = [];

    for (const id of parsed.data.ticket_ids) {
      const { data: ticket } = await sb.from("tickets").select("*").eq("id", id).maybeSingle();
      if (!ticket) { blocked.push({ id, reason: "not found" }); continue; }
      const { data: campaign } = await sb.from("campaigns").select("owner_id").eq("id", ticket.campaign_id).maybeSingle();
      if (!campaign || campaign.owner_id !== user.id) { blocked.push({ id, reason: "forbidden" }); continue; }
      if (parsed.data.action === "approve") {
        if (ticket.current_state !== "pending_approval") {
          blocked.push({ id, reason: `state is ${ticket.current_state}` }); continue;
        }
        // Per §2.3: require non-empty reviews AND all required reviewers passing.
        const { data: settings } = await sb.from("campaign_settings").select("approval").eq("campaign_id", ticket.campaign_id).maybeSingle();
        // Per §3 (4th-pass): use resolveRequiredReviewers so an empty array does
        // NOT collapse the six-reviewer pipeline.
        const required = resolveRequiredReviewers(
          (settings?.approval as { required_reviewers?: string[] })?.required_reviewers,
        );
        const { data: reviews } = await sb.from("ai_reviews").select("reviewer_role, decision, status").eq("ticket_id", id).eq("email_version_id", ticket.current_email_version_id);
        const allReviews = reviews ?? [];
        if (allReviews.length === 0) {
          blocked.push({ id, reason: "no reviews recorded" }); continue;
        }
        let failed = false;
        for (const role of required) {
          const r = allReviews.find((x) => x.reviewer_role === role);
          if (!r) { blocked.push({ id, reason: `missing review: ${role}` }); failed = true; break; }
          if (r.status !== "completed" || r.decision !== "pass") {
            blocked.push({ id, reason: `${role} ${r.decision} (${r.status})` });
            failed = true;
            break;
          }
        }
        if (failed) continue;
        // Per §5 (5th-pass): use transitionTicket so the state machine records
        // the transition in workflow_events and asserts legality. The previous
        // version did raw SQL, bypassing both.
        try {
          await transitionTicket({
            ticket_id: id,
            from: "pending_approval" as any,
            to: "approved" as any,
            actor_id: user.id,
          });
        } catch (e) {
          blocked.push({ id, reason: (e as Error).message });
          continue;
        }
        await sb.from("tickets").update({
          approval_status: "approved",
          updated_at: new Date().toISOString(),
        }).eq("id", id);
        await sb.from("approval_events").insert({
          ticket_id: id,
          actor_id: user.id,
          action: "approve",
          email_version_id: ticket.current_email_version_id,
        });
        approved.push(id);
      } else {
        // Per §9 (4th-pass): use the state machine for bulk reject. The
        // previous version did raw SQL and could cancel a `sent` ticket
        // (which should be terminal).
        // Per pipeline verification: all REJECTABLE states can transition
        // directly to "cancelled" — the fallback through needs_attention
        // was buggy (illegal from queued/approved/paused/blocked/retry_scheduled/failed).
        if (!REJECTABLE_SOURCES.includes(ticket.current_state)) {
          blocked.push({ id, reason: `cannot reject from state ${ticket.current_state}` });
          continue;
        }
        try {
          await transitionTicket({
            ticket_id: id,
            from: ticket.current_state as any,
            to: "cancelled" as any,
            actor_id: user.id,
          });
        } catch (e) {
          blocked.push({ id, reason: (e as Error).message });
          continue;
        }
        await sb.from("tickets").update({
          approval_status: "rejected",
          updated_at: new Date().toISOString(),
        }).eq("id", id);
        await sb.from("approval_events").insert({ ticket_id: id, actor_id: user.id, action: "reject" });
        approved.push(id);
      }
    }

    await audit({
      actor_id: user.id,
      action: `approval.bulk_${parsed.data.action}`,
      resource_type: "ticket",
      resource_id: null,
      campaign_id: null,
      ticket_id: null,
      metadata: { approved, blocked },
    });

    return ok({ approved, blocked });
  } catch (e) {
    return failInternal((e as Error).message);
  }
}
