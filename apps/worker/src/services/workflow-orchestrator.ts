import { getServiceSupabase, aggregateReviews, transitionTicket } from "@mailpilot/server-core";
import type { AiReview, ReviewerRole, TicketState } from "@mailpilot/shared";
import { resolveRequiredReviewers } from "@mailpilot/shared";
import { getQueue, enqueueIdempotent } from "../queues/enqueue";
import { QUEUE_NAMES } from "../queues/names";
import { MAX_REVISION_CYCLES } from "../config";

/**
 * Workflow orchestrator — single source of truth for advancing a ticket
 * through the pipeline. Called by:
 *   - `/api/campaigns/:id/start` (kicks off queued tickets)
 *   - each processor's completion path
 *   - the recovery sweep on worker startup
 *
 * The orchestrator NEVER trusts in-memory state — it reads `current_state`
 * from the DB and uses `atomic_transition_ticket` for optimistic concurrency.
 *
 * State machine (matches packages/shared/src/transitions.ts):
 *   queued → analyzing → drafting → humanizing → grok_reviews → gemini_qa
 *     → quality_gate → pending_approval → approved → ready_to_send → sending → sent
 *                       (or → revising → humanizing → … on failure)
 *
 * Per-stage logic:
 *   - analyze/generate/humanize: each processor transitions the ticket into
 *     the next state and calls `orchestrate(ticketId)` to enqueue the next job.
 *   - grok_reviews: enqueue 4 jobs (one per role). Each review processor
 *     inserts its row and calls `checkReviewsAndAdvance(..., "grok_reviews")`
 *     via completion-tracker.ts. The tracker transitions to gemini_qa only
 *     when all 4 are complete.
 *   - gemini_qa: same pattern, 2 jobs.
 *   - quality_gate: this orchestrator function aggregates reviews and decides
 *     pass / revise / needs_attention.
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

export async function orchestrate(ticketId: string): Promise<void> {
  const sb = getServiceSupabase();
  const { data: ticket } = await sb
    .from("tickets")
    .select("*")
    .eq("id", ticketId)
    .maybeSingle();
  if (!ticket) return;

  const state = ticket.current_state as TicketState;
  const versionId = ticket.current_email_version_id as string | null;

  switch (state) {
    case "queued":
      await enqueueIdempotent(QUEUE_NAMES.analysis, "analyze", { ticketId }, `analyze-${ticketId}`);
      break;
    case "analyzing":
      // analyze.processor.ts will transition and call orchestrate() again.
      break;
    case "drafting":
      await enqueueIdempotent(QUEUE_NAMES.generation, "generate", { ticketId }, `generate-${ticketId}`);
      break;
    case "humanizing":
      await enqueueIdempotent(QUEUE_NAMES.humanization, "humanize", { ticketId }, `humanize-${ticketId}`);
      break;
    case "grok_reviews": {
      if (!versionId) break;
      // Enqueue any missing Grok review jobs. The completion tracker handles
      // the transition to gemini_qa when all 4 are done.
      let enqueuedAny = false;
      for (const role of GROK_ROLES) {
        const { data: existing } = await sb
          .from("ai_reviews")
          .select("id")
          .eq("ticket_id", ticketId)
          .eq("email_version_id", versionId)
          .eq("reviewer_role", role)
          .maybeSingle();
        if (!existing) {
          await enqueueIdempotent(
            QUEUE_NAMES.reviews,
            "review",
            { ticketId, role, emailVersionId: versionId },
            `review-${ticketId}-${role}-v${versionId}`,
          );
          enqueuedAny = true;
        }
      }
      // Per pipeline verification: if all 4 reviews were already complete
      // (e.g., after a recovery sweep re-ran the orchestrator), the
      // completion tracker would never fire because no new review job ran.
      // Manually trigger the completion check.
      if (!enqueuedAny) {
        const { checkReviewsAndAdvance } = await import("./completion-tracker");
        await checkReviewsAndAdvance(ticketId, versionId, "grok_reviews");
      }
      break;
    }
    case "gemini_qa": {
      if (!versionId) break;
      let enqueuedAny = false;
      for (const role of QA_ROLES) {
        const { data: existing } = await sb
          .from("ai_reviews")
          .select("id")
          .eq("ticket_id", ticketId)
          .eq("email_version_id", versionId)
          .eq("reviewer_role", role)
          .maybeSingle();
        if (!existing) {
          await enqueueIdempotent(
            QUEUE_NAMES.qa,
            "qa",
            { ticketId, role, emailVersionId: versionId },
            `qa-${ticketId}-${role}-v${versionId}`,
          );
          enqueuedAny = true;
        }
      }
      // Same fix as grok_reviews — if all QA reviews are already done,
      // manually trigger the completion check.
      if (!enqueuedAny) {
        const { checkReviewsAndAdvance } = await import("./completion-tracker");
        await checkReviewsAndAdvance(ticketId, versionId, "gemini_qa");
      }
      break;
    }
    case "quality_gate":
      await runQualityGate(ticketId);
      break;
    case "revising":
      await enqueueIdempotent(
        QUEUE_NAMES.revisions,
        "revise",
        { ticketId },
        `revise-${ticketId}-${Date.now()}`,
      );
      break;
    case "pending_approval":
    case "approved":
    case "ready_to_send":
    case "gmail_draft_created":
    case "sending":
    case "sent":
    case "send_status_unknown":
    case "needs_attention":
    case "paused":
    case "blocked":
    case "retry_scheduled":
    case "failed":
    case "cancelled":
      // No-op — terminal, attention, or waiting-for-user states.
      break;
  }

  void getQueue;
}

async function runQualityGate(ticketId: string): Promise<void> {
  const sb = getServiceSupabase();
  const { data: ticket } = await sb
    .from("tickets")
    .select("*, campaigns(owner_id)")
    .eq("id", ticketId)
    .maybeSingle();
  if (!ticket) return;
  if (ticket.current_state !== "quality_gate") return;
  if (!ticket.current_email_version_id) {
    await transitionTicket({
      ticket_id: ticketId,
      from: "quality_gate",
      to: "needs_attention",
      actor_id: null,
      reason: "Quality gate reached with no current email version",
    });
    return;
  }

  const campaign = ticket.campaigns as { owner_id: string } | null;
  const ownerId = campaign?.owner_id ?? null;

  // Read campaign settings to get required_reviewers and min_score.
  const { data: settings } = await sb
    .from("campaign_settings")
    .select("*")
    .eq("campaign_id", ticket.campaign_id)
    .maybeSingle();
  const approval = (settings?.approval ?? {}) as {
    required_reviewers?: string[];
    min_score?: number;
  };
  // Per §3 (4th-pass): use resolveRequiredReviewers so an empty array does
  // NOT collapse the six-reviewer pipeline. The bare `??` operator treats
  // `[]` and `undefined` identically, which silently bypasses every gate.
  const requiredReviewers = resolveRequiredReviewers(approval.required_reviewers);
  const minScore = approval.min_score ?? 70;

  const { data: reviewsData } = await sb
    .from("ai_reviews")
    .select("*")
    .eq("ticket_id", ticketId)
    .eq("email_version_id", ticket.current_email_version_id);
  const reviews = (reviewsData ?? []) as unknown as AiReview[];

  // HARD FAIL: any required reviewer is missing entirely OR still running.
  const missing = requiredReviewers.filter(
    (role) => !reviews.find((r) => r.reviewer_role === role),
  );
  if (missing.length > 0) {
    await transitionTicket({
      ticket_id: ticketId,
      from: "quality_gate",
      to: "needs_attention",
      actor_id: null,
      reason: `Missing required reviews: ${missing.join(", ")}`,
    });
    return;
  }

  // HARD FAIL: any required reviewer errored.
  const errored = reviews.filter(
    (r) => requiredReviewers.includes(r.reviewer_role) && r.decision === "error",
  );
  if (errored.length > 0) {
    await transitionTicket({
      ticket_id: ticketId,
      from: "quality_gate",
      to: "needs_attention",
      actor_id: null,
      reason: `Reviews errored: ${errored.map((r) => r.reviewer_role).join(", ")}`,
    });
    return;
  }

  const agg = aggregateReviews(reviews, requiredReviewers, minScore);

  if (agg.final === "pass") {
    // Auto-approval check — campaign may still require manual approval.
    const autoMode = approval && (approval as { mode?: string }).mode === "auto";
    if (autoMode) {
      // Per §4 (5th-pass): the previous version auto-approved on
      // `agg.final === "pass"` + `mode === "auto"` alone. That bypassed every
      // other eligibility check (suppression list, sending caps, required
      // attachments, recipient data unchanged). A suppressed recipient whose
      // reviews passed would auto-approve, enqueue send, and then `processSend`
      // would throw "Recipient on suppression list" — BullMQ retries 5x, the
      // ticket stays stuck in ready_to_send. Route through canAutoApprove(),
      // which checks all of these.
      const { canAutoApprove } = await import("./approval-service");
      const { ok: canApprove, reasons } = await canAutoApprove(ticketId);
      if (!canApprove) {
        await transitionTicket({
          ticket_id: ticketId,
          from: "quality_gate",
          to: "needs_attention",
          actor_id: null,
          reason: `Auto-approval blocked: ${reasons.join("; ")}`,
        });
        return;
      }
      await transitionTicket({
        ticket_id: ticketId,
        from: "quality_gate",
        to: "approved",
        actor_id: null,
        reason: "Auto-approved (all checks passed, campaign mode=auto)",
      });
      // Per bug #1: also set approval_status so the draft route's gate passes.
      // transitionTicket only writes current_state/last_error; approval_status
      // is a separate column that must be updated explicitly.
      await sb.from("tickets").update({
        approval_status: "auto_approved",
        updated_at: new Date().toISOString(),
      }).eq("id", ticketId);
      await sb.from("approval_events").insert({
        ticket_id: ticketId,
        actor_id: null,
        action: "auto_approve",
        email_version_id: ticket.current_email_version_id,
        reason: "All required reviewers passed and eligibility checks satisfied",
      });
      // Then advance to ready_to_send
      await transitionTicket({
        ticket_id: ticketId,
        from: "approved",
        to: "ready_to_send",
        actor_id: null,
      });
      // Auto-send if campaign opted in. Per §14 (NEW): pass `auto: true` so
      // processSend can verify the campaign actually opted into auto-send
      // (defense in depth — if the flag is later disabled, the auto-send job
      // refuses to fire).
      const shouldAutoSend = (approval as { auto_send?: boolean }).auto_send === true;
      if (shouldAutoSend) {
        await enqueueIdempotent(
          QUEUE_NAMES.delivery,
          "send",
          { ticketId, ownerId, auto: true },
          `send-${ticketId}-${ticket.current_email_version_id}`,
        );
      }
    } else {
      await transitionTicket({
        ticket_id: ticketId,
        from: "quality_gate",
        to: "pending_approval",
        actor_id: null,
      });
    }
  } else if (agg.final === "blocked") {
    await transitionTicket({
      ticket_id: ticketId,
      from: "quality_gate",
      to: "needs_attention",
      actor_id: null,
      reason: "Quality gate blocked — review issues are critical",
    });
  } else {
    // revise
    // Per §7 and §20: revision cycles are a per-campaign setting. The env
    // var MAX_REVISION_CYCLES is a fallback default.
    const campaignMaxCycles = (settings?.revision as { max_cycles?: number } | null)?.max_cycles;
    const maxCycles = typeof campaignMaxCycles === "number" ? campaignMaxCycles : MAX_REVISION_CYCLES;
    if (ticket.revision_attempts >= maxCycles) {
      await transitionTicket({
        ticket_id: ticketId,
        from: "quality_gate",
        to: "needs_attention",
        actor_id: null,
        reason: `Max revision cycles (${maxCycles}) reached`,
      });
      return;
    }
    await transitionTicket({
      ticket_id: ticketId,
      from: "quality_gate",
      to: "revising",
      actor_id: null,
      reason: `Failed reviewers: ${agg.failed_reviewers.join(", ")}`,
    });
    await orchestrate(ticketId);
  }
}
