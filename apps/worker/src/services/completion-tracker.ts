import { getServiceSupabase } from "@mailpilot/server-core";
import type { ReviewerRole } from "@mailpilot/shared";

/**
 * Completion tracker — answers "are all required reviews for this version
 * complete?" without races. Used by the orchestrator to advance the pipeline.
 *
 * The pattern:
 *   1. A processor inserts an ai_reviews row when its individual review finishes.
 *   2. The processor calls `checkAndAdvance(ticketId, versionId, stage)`.
 *   3. `checkAndAdvance` queries ai_reviews for the version + required roles;
 *      if all are present AND not in 'running' status, it advances the ticket.
 *
 * The advance uses atomic_transition_ticket for optimistic concurrency — if
 * two processors race, only one wins the transition.
 */

const GROK_ROLES: ReviewerRole[] = [
  "grok_defensibility",
  "grok_human_tone",
  "grok_content_fit",
  "grok_delivery_hygiene",
];

const QA_ROLES: ReviewerRole[] = [
  "gemini_qa_structure",
  "gemini_qa_personalization",
];

export async function allReviewsComplete(
  ticketId: string,
  versionId: string,
  roles: ReviewerRole[],
): Promise<{ complete: boolean; reviews: Array<{ reviewer_role: string; decision: string; status: string }> }> {
  const sb = getServiceSupabase();
  const { data } = await sb
    .from("ai_reviews")
    .select("reviewer_role, decision, status")
    .eq("ticket_id", ticketId)
    .eq("email_version_id", versionId);
  const reviews = data ?? [];
  // Complete only when every required role has a non-running review row.
  const complete = roles.every((role) => {
    const r = reviews.find((x) => x.reviewer_role === role);
    return r && r.status !== "running";
  });
  return { complete, reviews };
}

/**
 * Called by review/qa processors after they insert their ai_reviews row.
 * If all required Grok reviews are complete, transitions ticket
 * grok_reviews → gemini_qa. If all required QA is complete, transitions
 * gemini_qa → quality_gate and enqueues the quality_gate job.
 */
export async function checkReviewsAndAdvance(
  ticketId: string,
  versionId: string,
  justCompletedStage: "grok_reviews" | "gemini_qa",
): Promise<void> {
  const sb = getServiceSupabase();
  const { data: ticket } = await sb
    .from("tickets")
    .select("current_state, campaign_id")
    .eq("id", ticketId)
    .maybeSingle();
  if (!ticket) return;

  if (justCompletedStage === "grok_reviews") {
    if (ticket.current_state !== "grok_reviews") return;
    const { complete } = await allReviewsComplete(ticketId, versionId, GROK_ROLES);
    if (!complete) return;
    // Atomically transition grok_reviews → gemini_qa (only if still in grok_reviews)
    const result = await sb.rpc("atomic_transition_ticket", {
      p_ticket_id: ticketId,
      p_from: "grok_reviews",
      p_to: "gemini_qa",
    });
    if (result.error || !result.data) return;
    // Enqueue the QA jobs
    const { enqueueIdempotent } = await import("../queues/enqueue");
    const { QUEUE_NAMES } = await import("../queues/names");
    for (const role of QA_ROLES) {
      await enqueueIdempotent(
        QUEUE_NAMES.qa,
        "qa",
        { ticketId, role, emailVersionId: versionId },
        `qa-${ticketId}-${role}-v${versionId}`,
      );
    }
  } else if (justCompletedStage === "gemini_qa") {
    if (ticket.current_state !== "gemini_qa") return;
    const { complete } = await allReviewsComplete(ticketId, versionId, QA_ROLES);
    if (!complete) return;
    const result = await sb.rpc("atomic_transition_ticket", {
      p_ticket_id: ticketId,
      p_from: "gemini_qa",
      p_to: "quality_gate",
    });
    if (result.error || !result.data) return;
    // Route through the orchestrator — it runs runQualityGate, which is the
    // single source of truth for auto-approval, auto-send, blocked/errored
    // review handling, and revision cycle cap. (Previously this enqueued
    // directly to the revisions queue, which bypassed all of those checks.)
    const { orchestrate } = await import("./workflow-orchestrator");
    await orchestrate(ticketId);
  }
}
