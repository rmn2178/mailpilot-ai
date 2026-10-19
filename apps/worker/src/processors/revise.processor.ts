import type { Job } from "bullmq";
import {
  getServiceSupabase,
  dispatch,
  getPrompt,
  APP_SAFETY_PREAMBLE,
  transitionTicket,
  createEmailVersion,
  setCurrentEmailVersion,
  aggregateReviews,
  recordWorkflowEvent,
  recordUsage,
  estimateCost,
  sanitizeHtml,
} from "@mailpilot/server-core";
import type { AiReview } from "@mailpilot/shared";
import { resolveRequiredReviewers } from "@mailpilot/shared";
import { MAX_REVISION_CYCLES } from "../config";

/**
 * Revision processor.
 *
 * Per spec §11:
 *   1. Collect failed checks.
 *   2. Consolidate findings without discarding individual reports.
 *   3. Send the current version + actionable findings to Gemini.
 *   4. Generate a new immutable email version.
 *   5. Run mandatory humanization.
 *   6. Re-run configured reviews and QA.
 *   7. Repeat up to MAX_REVISION_CYCLES.
 *   8. If unresolved, mark the ticket needs_attention.
 */
export async function processRevise(job: Job<{ ticketId: string }>): Promise<void> {
  const { ticketId } = job.data;
  const sb = getServiceSupabase();

  const { data: ticket } = await sb.from("tickets").select("*").eq("id", ticketId).maybeSingle();
  if (!ticket) throw new Error(`Ticket ${ticketId} not found`);

  // processRevise only handles the "revising" state. The "quality_gate" state
  // is handled by runQualityGate in the workflow orchestrator, which is the
  // single source of truth for pass/revise/blocked/needs_attention decisions
  // and for auto-approval / auto-send. processRevise is invoked by the
  // orchestrator after it has already decided a revision is needed.
  if (ticket.current_state !== "revising") return;

  // Per §7 and §20: revision cycles are a per-campaign setting. Read it from
  // campaign_settings.revision.max_cycles, falling back to the env var.
  const { data: settings } = await sb
    .from("campaign_settings")
    .select("*")
    .eq("campaign_id", ticket.campaign_id)
    .maybeSingle();
  const campaignMaxCycles = (settings?.revision as { max_cycles?: number } | null)?.max_cycles;
  const maxCycles = typeof campaignMaxCycles === "number" ? campaignMaxCycles : MAX_REVISION_CYCLES;
  if (ticket.revision_attempts >= maxCycles) {
    await transitionTicket({
      ticket_id: ticketId,
      from: "revising",
      to: "needs_attention",
      actor_id: null,
      reason: `Max revision cycles (${maxCycles}) reached`,
    });
    return;
  }

  const { data: reviews } = await sb
    .from("ai_reviews")
    .select("*")
    .eq("ticket_id", ticketId)
    .eq("email_version_id", ticket.current_email_version_id);

  // Per §3 (4th-pass): use resolveRequiredReviewers so an empty array does
  // NOT collapse the six-reviewer pipeline.
  const required = resolveRequiredReviewers(
    (settings?.approval as { required_reviewers?: string[] })?.required_reviewers,
  );
  const minScore = (settings?.approval as { min_score?: number })?.min_score ?? 70;
  const agg = aggregateReviews((reviews ?? []) as AiReview[], required, minScore);

  if (agg.final === "pass") {
    // Should not normally happen (the orchestrator only enqueues revise after
    // deciding revision is needed), but handle it defensively. We cannot go
    // directly from revising → quality_gate (not a legal transition). Re-run
    // the pipeline from humanizing, which will re-create a version, run
    // humanization, then re-run all reviews. The quality gate will then
    // decide pass/revise/blocked based on the fresh reviews.
    await transitionTicket({
      ticket_id: ticketId,
      from: "revising",
      to: "humanizing",
      actor_id: null,
      reason: "Reviews unexpectedly passed during revision — re-running pipeline",
    });
    const { orchestrate } = await import("../services/workflow-orchestrator");
    await orchestrate(ticketId);
    return;
  }

  const { data: version } = await sb
    .from("email_versions")
    .select("*")
    .eq("id", ticket.current_email_version_id)
    .maybeSingle();
  if (!version) throw new Error("No current email version");

  const systemPrompt = (await getPrompt("gemini_generate")) + "\n\n" + APP_SAFETY_PREAMBLE;
  const userPrompt = JSON.stringify({
    instruction: "Revise the email based on the consolidated findings. Preserve all supported facts and the required sections.",
    analysis_brief: ticket.analysis_brief,
    current_subject: version.subject,
    current_body_plain: version.body_plain,
    failed_reviewers: agg.failed_reviewers,
    findings: (reviews ?? []).flatMap((r) => (r as AiReview).issues ?? []),
    campaign_settings: settings?.writing,
  });

  const started = Date.now();
  const response = await dispatch({
    slot: "gemini_generate",
    systemPrompt,
    userPrompt,
    temperature: 0.4,
  });
  await recordUsage({
    campaign_id: ticket.campaign_id,
    ticket_id: ticketId,
    slot: "gemini_generate",
    provider: "gemini",
    model_id: response.model_id,
    tokens_in: response.usage?.tokens_in ?? 0,
    tokens_out: response.usage?.tokens_out ?? 0,
    duration_ms: Date.now() - started,
    cost_estimate_usd: estimateCost(response.model_id, response.usage?.tokens_in ?? 0, response.usage?.tokens_out ?? 0),
  });

  let parsed: { subject?: string; body_plain?: string; body_html?: string | null } | null = null;
  try { parsed = JSON.parse(response.text); } catch { parsed = null; }

  // Bump revision_attempts via the SQL function for atomicity.
  await sb.rpc("increment_revision_attempts", { p_ticket_id: ticketId });

  const v = await createEmailVersion({
    ticket_id: ticketId,
    subject: parsed?.subject ?? version.subject,
    body_plain: parsed?.body_plain ?? version.body_plain,
    body_html: parsed?.body_html ? sanitizeHtml(parsed.body_html) : version.body_html,
    source_references: version.source_references,
    attachment_manifest: version.attachment_manifest,
    created_by: "ai",
  });
  await setCurrentEmailVersion(ticketId, v.id);

  // Per bug #5: do NOT delete old-version reviews. The comment was wrong —
  // reviews are scoped by email_version_id, so the completion tracker and
  // quality gate never confuse old and new versions. Deleting them destroys
  // the audit trail (issues, evidence, scores) for the version that failed,
  // making post-hoc debugging impossible. The old reviews remain accessible
  // via the version history.

  // Transition to humanizing. The humanizer will advance to grok_reviews and
  // the orchestrator will enqueue the review jobs for the new version.
  await transitionTicket({
    ticket_id: ticketId,
    from: "revising",
    to: "humanizing",
    actor_id: null,
    reason: `Revision cycle ${ticket.revision_attempts + 1}`,
  });

  await recordWorkflowEvent({
    ticket_id: ticketId,
    campaign_id: ticket.campaign_id,
    stage: "quality_gate",
    event_type: "revision_created",
    metadata: {
      from_version: version.version_number,
      to_version: v.version_number,
      failed_reviewers: agg.failed_reviewers,
    },
  });

  const { orchestrate } = await import("../services/workflow-orchestrator");
  await orchestrate(ticketId);
}
