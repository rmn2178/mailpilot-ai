import { getServiceSupabase } from "../db";
import { transitionTicket, aggregateReviews } from "../workflow/index";
import { resolveRequiredReviewers } from "@mailpilot/shared";
import type { AiReview, ReviewerRole, TicketState } from "@mailpilot/shared";

/**
 * Determines what the next pipeline job should be for a given ticket state.
 * Returns a job descriptor that the /api/worker/process route can dispatch.
 * Does NOT enqueue — caller decides whether to fire-and-forget or await.
 */

const GROK_ROLES: ReviewerRole[] = ["grok_defensibility", "grok_human_tone", "grok_content_fit", "grok_delivery_hygiene"];
const QA_ROLES: ReviewerRole[] = ["gemini_qa_structure", "gemini_qa_personalization"];

export type PipelineJob =
  | { job: "import"; importId: string }
  | { job: "extract_file"; fileId: string }
  | { job: "analyze"; ticketId: string }
  | { job: "generate"; ticketId: string }
  | { job: "humanize"; ticketId: string }
  | { job: "review"; ticketId: string; role: ReviewerRole; emailVersionId: string }
  | { job: "quality_gate"; ticketId: string }
  | { job: "revise"; ticketId: string }
  | { job: "noop" };

export async function getNextJobs(ticketId: string): Promise<PipelineJob[]> {
  const sb = getServiceSupabase();
  const { data: ticket } = await sb.from("tickets").select("*").eq("id", ticketId).maybeSingle();
  if (!ticket) return [{ job: "noop" }];

  const state = ticket.current_state as TicketState;
  const versionId = ticket.current_email_version_id as string | null;

  switch (state) {
    case "queued":
      return [{ job: "analyze", ticketId }];
    case "drafting":
      return [{ job: "generate", ticketId }];
    case "humanizing":
      return [{ job: "humanize", ticketId }];
    case "grok_reviews": {
      if (!versionId) return [{ job: "noop" }];
      const jobs: PipelineJob[] = [];
      for (const role of GROK_ROLES) {
        const { data: existing } = await sb.from("ai_reviews").select("id").eq("ticket_id", ticketId).eq("email_version_id", versionId).eq("reviewer_role", role).maybeSingle();
        if (!existing) jobs.push({ job: "review", ticketId, role, emailVersionId: versionId });
      }
      return jobs.length > 0 ? jobs : [{ job: "noop" }];
    }
    case "gemini_qa": {
      if (!versionId) return [{ job: "noop" }];
      const jobs: PipelineJob[] = [];
      for (const role of QA_ROLES) {
        const { data: existing } = await sb.from("ai_reviews").select("id").eq("ticket_id", ticketId).eq("email_version_id", versionId).eq("reviewer_role", role).maybeSingle();
        if (!existing) jobs.push({ job: "review", ticketId, role: role as ReviewerRole, emailVersionId: versionId });
      }
      return jobs.length > 0 ? jobs : [{ job: "noop" }];
    }
    case "quality_gate":
      return [{ job: "quality_gate", ticketId }];
    case "revising":
      return [{ job: "revise", ticketId }];
    default:
      return [{ job: "noop" }];
  }
}

export async function runQualityGate(ticketId: string): Promise<void> {
  const sb = getServiceSupabase();
  const { data: ticket } = await sb.from("tickets").select("*, campaigns(owner_id)").eq("id", ticketId).maybeSingle();
  if (!ticket || ticket.current_state !== "quality_gate") return;
  if (!ticket.current_email_version_id) {
    await transitionTicket({ ticket_id: ticketId, from: "quality_gate", to: "needs_attention", actor_id: null, reason: "No current email version" });
    return;
  }

  const { data: settings } = await sb.from("campaign_settings").select("*").eq("campaign_id", ticket.campaign_id).maybeSingle();
  const approval = (settings?.approval ?? {}) as { required_reviewers?: string[]; min_score?: number; mode?: string; auto_send?: boolean };
  const requiredReviewers = resolveRequiredReviewers(approval.required_reviewers);
  const minScore = approval.min_score ?? 70;

  const { data: reviewsData } = await sb.from("ai_reviews").select("*").eq("ticket_id", ticketId).eq("email_version_id", ticket.current_email_version_id);
  const reviews = (reviewsData ?? []) as unknown as AiReview[];

  const missing = requiredReviewers.filter((role) => !reviews.find((r) => r.reviewer_role === role));
  if (missing.length > 0) {
    await transitionTicket({ ticket_id: ticketId, from: "quality_gate", to: "needs_attention", actor_id: null, reason: `Missing reviews: ${missing.join(", ")}` });
    return;
  }

  const errored = reviews.filter((r) => requiredReviewers.includes(r.reviewer_role) && r.decision === "error");
  if (errored.length > 0) {
    await transitionTicket({ ticket_id: ticketId, from: "quality_gate", to: "needs_attention", actor_id: null, reason: `Errored reviews: ${errored.map((r) => r.reviewer_role).join(", ")}` });
    return;
  }

  const agg = aggregateReviews(reviews, requiredReviewers, minScore);

  if (agg.final === "blocked") {
    await transitionTicket({ ticket_id: ticketId, from: "quality_gate", to: "needs_attention", actor_id: null, reason: "Blocked by reviewer" });
  } else if (agg.final === "revise") {
    await transitionTicket({ ticket_id: ticketId, from: "quality_gate", to: "revising", actor_id: null, reason: `Failed: ${agg.failed_reviewers.join(", ")}` });
  } else {
    // pass
    if (approval.mode === "auto") {
      await transitionTicket({ ticket_id: ticketId, from: "quality_gate", to: "approved", actor_id: null, reason: "Auto-approved" });
      await sb.from("tickets").update({ approval_status: "auto_approved", updated_at: new Date().toISOString() }).eq("id", ticketId);
      await sb.from("approval_events").insert({ ticket_id: ticketId, actor_id: null, action: "auto_approve", email_version_id: ticket.current_email_version_id, reason: "All reviewers passed" });
      await transitionTicket({ ticket_id: ticketId, from: "approved", to: "ready_to_send", actor_id: null });
    } else {
      await transitionTicket({ ticket_id: ticketId, from: "quality_gate", to: "pending_approval", actor_id: null });
    }
  }
}
