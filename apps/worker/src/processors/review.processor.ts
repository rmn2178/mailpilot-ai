import type { Job } from "bullmq";
import {
  getServiceSupabase,
  dispatch,
  getPrompt,
  APP_SAFETY_PREAMBLE,
  recordUsage,
  estimateCost,
} from "@mailpilot/server-core";
import type { ReviewerRole } from "@mailpilot/shared";

/**
 * Review processor — runs ONE reviewer (one of 4 Grok reviewers, 2 Gemini QA
 * reviewers, or the humanizer-as-reviewer case). Each reviewer runs as an
 * independent job, enabling concurrent execution subject to actual provider
 * quotas.
 *
 * After inserting the ai_reviews row, the processor calls the completion
 * tracker, which transitions the ticket to the next stage only when ALL
 * required reviews for the version are complete. This eliminates the race
 * condition where the orchestrator would advance before reviews were written.
 *
 * Parse-failure handling (per §3.1): if the model output is not valid JSON,
 * the review is recorded with `decision = 'error'` and `status = 'failed'`.
 * This is distinct from a legitimate `revise` decision and is surfaced as a
 * quality-gate failure requiring human attention.
 */
export async function processReview(
  job: Job<{ ticketId: string; role: ReviewerRole; emailVersionId: string }>,
): Promise<void> {
  const { ticketId, role, emailVersionId } = job.data;
  const sb = getServiceSupabase();

  const [{ data: ticket }, { data: version }] = await Promise.all([
    sb.from("tickets").select("*").eq("id", ticketId).maybeSingle(),
    sb.from("email_versions").select("*").eq("id", emailVersionId).maybeSingle(),
  ]);
  if (!ticket || !version) throw new Error("Ticket or version missing");

  // Idempotency: if a review row for this (ticket, version, role) already exists
  // with status completed/failed, skip — this is a retry.
  const { data: existing } = await sb
    .from("ai_reviews")
    .select("id, status")
    .eq("ticket_id", ticketId)
    .eq("email_version_id", emailVersionId)
    .eq("reviewer_role", role)
    .maybeSingle();
  if (existing && existing.status !== "running") {
    // Already done — just trigger the completion tracker in case it stalled.
    const { checkReviewsAndAdvance } = await import("../services/completion-tracker");
    const stage = role.startsWith("grok") ? "grok_reviews" : "gemini_qa";
    await checkReviewsAndAdvance(ticketId, emailVersionId, stage);
    return;
  }

  const systemPrompt = (await getPrompt(role)) + "\n\n" + APP_SAFETY_PREAMBLE;
  const userPrompt = JSON.stringify({
    subject: version.subject,
    body_plain: version.body_plain,
    body_html: version.body_html,
    recipient_email: ticket.recipient_email,
    version_id: version.id,
    version_number: version.version_number,
    // Thread the analysis brief through so reviewers can compare the email
    // against the approved objective, required sections, and source facts.
    analysis_brief: ticket.analysis_brief ?? null,
  });

  const startedAt = new Date().toISOString();
  const started = Date.now();

  let status: "completed" | "failed" = "completed";
  let decision: "pass" | "revise" | "blocked" | "error" = "error";
  let score: number | null = null;
  let summary = "";
  let issues: unknown[] = [];
  let evidence_references: string[] = [];
  let errorCode: string | null = null;
  // Per bug #7: track the actual model_id and provider from the response
  // so the audit trail is accurate. The previous version hardcoded
  // "grok-2-latest" / "gemini-1.5-pro" regardless of env overrides.
  let actualModelId: string = role.startsWith("grok") ? "grok-2-latest" : "gemini-1.5-pro";
  let actualProvider: "grok" | "gemini" = role.startsWith("grok") ? "grok" : "gemini";

  try {
    const response = await dispatch({
      slot: role,
      systemPrompt,
      userPrompt,
      temperature: 0.2,
      // Providers should request JSON mode (see gemini.provider.ts / grok.provider.ts).
    });
    // Per bug #7: capture the actual model_id and provider from the response.
    actualModelId = response.model_id;
    actualProvider = response.provider;
    await recordUsage({
      campaign_id: ticket.campaign_id,
      ticket_id: ticketId,
      slot: role,
      provider: role.startsWith("grok") ? "grok" : "gemini",
      model_id: response.model_id,
      tokens_in: response.usage?.tokens_in ?? 0,
      tokens_out: response.usage?.tokens_out ?? 0,
      duration_ms: Date.now() - started,
      cost_estimate_usd: estimateCost(response.model_id, response.usage?.tokens_in ?? 0, response.usage?.tokens_out ?? 0),
    });

    let parsed: {
      decision?: string;
      score?: number;
      summary?: string;
      issues?: Array<{ severity: string; code: string; message: string; quoted_text?: string; evidence?: string[] }>;
      evidence_references?: string[];
      version_reviewed?: string;
    } | null = null;
    try {
      parsed = JSON.parse(response.text);
    } catch {
      // Per §3.1: malformed provider output is an ERROR, not silently "revise".
      status = "failed";
      decision = "error";
      errorCode = "PARSE_ERROR";
      summary = `Provider returned non-JSON response (${response.text.length} chars).`;
    }

    if (parsed) {
      // Per §19 (NEW): for grok_content_fit, the prompt requires version_reviewed
      // to match the version the job was dispatched against. A mismatch means
      // the model is reviewing the wrong content — record as error.
      if (role === "grok_content_fit" && parsed.version_reviewed && parsed.version_reviewed !== version.id) {
        status = "failed";
        decision = "error";
        errorCode = "VERSION_MISMATCH";
        summary = `Model reviewed version ${parsed.version_reviewed} but job was for version ${version.id}`;
      }
      const d = parsed.decision;
      if (decision !== "error") {
        if (d === "pass" || d === "revise" || d === "blocked") {
          decision = d;
        } else {
          decision = "error";
          errorCode = "UNKNOWN_DECISION";
          summary = `Provider returned unknown decision: ${d ?? "(missing)"}`;
          status = "failed";
        }
      }
      if (typeof parsed.score === "number") score = parsed.score;
      if (!summary) summary = parsed.summary || "";
      issues = Array.isArray(parsed.issues) ? parsed.issues : [];
      evidence_references = Array.isArray(parsed.evidence_references) ? parsed.evidence_references : [];
    }
  } catch (e) {
    status = "failed";
    decision = "error";
    errorCode = (e as Error).name || "PROVIDER_ERROR";
    summary = (e as Error).message;
  }

  const reviewRow = {
    ticket_id: ticketId,
    email_version_id: emailVersionId,
    reviewer_role: role,
    provider: actualProvider,
    model_id: actualModelId,
    status,
    score,
    decision,
    issues,
    evidence_references,
    summary,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    duration_ms: Date.now() - started,
    usage_metadata: null,
    error_code: errorCode,
  };

  if (existing) {
    await sb.from("ai_reviews").update(reviewRow).eq("id", existing.id);
  } else {
    await sb.from("ai_reviews").insert(reviewRow);
  }

  // Trigger the completion tracker. It no-ops if not all required reviews are
  // done; it advances the ticket when the last one completes.
  const { checkReviewsAndAdvance } = await import("../services/completion-tracker");
  const stage = role.startsWith("grok") ? "grok_reviews" : "gemini_qa";
  await checkReviewsAndAdvance(ticketId, emailVersionId, stage);
}
