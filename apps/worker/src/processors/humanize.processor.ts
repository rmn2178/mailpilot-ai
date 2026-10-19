import type { Job } from "bullmq";
import {
  getServiceSupabase,
  dispatch,
  getPrompt,
  APP_SAFETY_PREAMBLE,
  transitionTicket,
  createEmailVersion,
  setCurrentEmailVersion,
  recordWorkflowEvent,
  recordUsage,
  estimateCost,
  sanitizeHtml,
} from "@mailpilot/server-core";

/**
 * Mandatory humanization processor.
 *
 * Per spec §8.3: runs for EVERY email version eligible for delivery, including
 * revisions. Editorial pass, not AI-detection evasion.
 *
 * Honors the humanizer's `decision`: `pass` advances to grok_reviews; `revise`
 * creates the new version and advances (the reviewers will catch remaining
 * issues); `blocked` transitions to needs_attention and does NOT advance.
 */
export async function processHumanize(job: Job<{ ticketId: string }>): Promise<void> {
  const { ticketId } = job.data;
  const sb = getServiceSupabase();

  const { data: ticket } = await sb.from("tickets").select("*").eq("id", ticketId).maybeSingle();
  if (!ticket) throw new Error(`Ticket ${ticketId} not found`);
  if (ticket.current_state !== "humanizing") return;
  if (!ticket.current_email_version_id) throw new Error("No current email version to humanize");

  const { data: version } = await sb.from("email_versions").select("*").eq("id", ticket.current_email_version_id).maybeSingle();
  if (!version) throw new Error("Email version not found");

  const systemPrompt = (await getPrompt("humanizer")) + "\n\n" + APP_SAFETY_PREAMBLE;
  const userPrompt = JSON.stringify({
    subject: version.subject,
    body_plain: version.body_plain,
    body_html: version.body_html,
  });

  const started = Date.now();
  const response = await dispatch({
    slot: "gemini_generate", // reuse generate slot — humanizer is editorial, not a separate AI slot
    systemPrompt,
    userPrompt,
    temperature: 0.5,
  });

  await recordUsage({
    campaign_id: ticket.campaign_id,
    ticket_id: ticketId,
    slot: "humanizer",
    provider: "gemini",
    model_id: response.model_id,
    tokens_in: response.usage?.tokens_in ?? 0,
    tokens_out: response.usage?.tokens_out ?? 0,
    duration_ms: Date.now() - started,
    cost_estimate_usd: estimateCost(response.model_id, response.usage?.tokens_in ?? 0, response.usage?.tokens_out ?? 0),
  });

  let parsed: {
    subject?: string;
    body_plain?: string;
    body_html?: string | null;
    decision?: string;
    editorial_score?: number;
    issues?: Array<{ severity: string; code: string; message: string }>;
  } | null = null;
  try {
    parsed = JSON.parse(response.text);
  } catch {
    parsed = null;
  }

  // Per bug M: if the humanizer returned non-JSON, record the failure
  // explicitly (matching review.processor.ts's PARSE_ERROR handling) instead
  // of silently creating a duplicate version.
  if (!parsed) {
    await transitionTicket({
      ticket_id: ticketId,
      from: "humanizing",
      to: "needs_attention",
      actor_id: null,
      reason: `Humanizer returned non-JSON response (${response.text.length} chars). Manual review required.`,
    });
    await recordWorkflowEvent({
      ticket_id: ticketId,
      campaign_id: ticket.campaign_id,
      stage: "humanization",
      event_type: "humanizer_parse_error",
      metadata: {
        response_length: response.text.length,
        response_preview: response.text.slice(0, 200),
      },
      error: "PARSE_ERROR",
    });
    return;
  }

  const decision = parsed.decision;
  // Per §2.6: respect `blocked`. Don't create a new version or advance.
  if (decision === "blocked") {
    await transitionTicket({
      ticket_id: ticketId,
      from: "humanizing",
      to: "needs_attention",
      actor_id: null,
      reason: "Humanizer returned blocked — manual review required",
    });
    return;
  }

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

  await recordWorkflowEvent({
    ticket_id: ticketId,
    campaign_id: ticket.campaign_id,
    stage: "humanization",
    event_type: "humanized",
    metadata: {
      version: v.version_number,
      decision: decision ?? "unknown",
      editorial_score: parsed?.editorial_score ?? null,
    },
  });

  await transitionTicket({
    ticket_id: ticketId,
    from: "humanizing",
    to: "grok_reviews",
    actor_id: null,
  });
  const { orchestrate } = await import("../services/workflow-orchestrator");
  await orchestrate(ticketId);
}
