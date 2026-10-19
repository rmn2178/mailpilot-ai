import { getServiceSupabase } from "../db";
import { dispatch } from "../ai/dispatcher";
import { getPrompt, APP_SAFETY_PREAMBLE } from "../ai/prompt-registry";
import { transitionTicket, createEmailVersion, setCurrentEmailVersion, aggregateReviews, recordWorkflowEvent } from "../workflow/index";
import { recordUsage, estimateCost } from "../ai/usage-tracker";
import { sanitizeHtml } from "../validation/index";
import { resolveRequiredReviewers } from "@mailpilot/shared";
import type { AiReview } from "@mailpilot/shared";

const MAX_REVISION_CYCLES = parseInt(process.env.MAX_REVISION_CYCLES ?? "3", 10);

export async function runRevise(ticketId: string): Promise<void> {
  const sb = getServiceSupabase();
  const { data: ticket } = await sb.from("tickets").select("*").eq("id", ticketId).maybeSingle();
  if (!ticket) throw new Error(`Ticket ${ticketId} not found`);
  if (ticket.current_state !== "revising") return;

  const { data: settings } = await sb.from("campaign_settings").select("*").eq("campaign_id", ticket.campaign_id).maybeSingle();
  const campaignMaxCycles = (settings?.revision as { max_cycles?: number } | null)?.max_cycles;
  const maxCycles = typeof campaignMaxCycles === "number" ? campaignMaxCycles : MAX_REVISION_CYCLES;

  if (ticket.revision_attempts >= maxCycles) {
    await transitionTicket({ ticket_id: ticketId, from: "revising", to: "needs_attention", actor_id: null, reason: `Max revision cycles (${maxCycles}) reached` });
    return;
  }

  const { data: reviews } = await sb.from("ai_reviews").select("*").eq("ticket_id", ticketId).eq("email_version_id", ticket.current_email_version_id);
  const required = resolveRequiredReviewers((settings?.approval as { required_reviewers?: string[] })?.required_reviewers);
  const minScore = (settings?.approval as { min_score?: number })?.min_score ?? 70;
  const agg = aggregateReviews((reviews ?? []) as AiReview[], required, minScore);

  if (agg.final === "pass") {
    await transitionTicket({ ticket_id: ticketId, from: "revising", to: "humanizing", actor_id: null, reason: "Reviews unexpectedly passed — re-running pipeline" });
    return;
  }

  const { data: version } = await sb.from("email_versions").select("*").eq("id", ticket.current_email_version_id).maybeSingle();
  if (!version) throw new Error("No current email version");

  const systemPrompt = (await getPrompt("gemini_generate")) + "\n\n" + APP_SAFETY_PREAMBLE;
  const userPrompt = JSON.stringify({ instruction: "Revise the email based on the consolidated findings.", analysis_brief: ticket.analysis_brief, current_subject: version.subject, current_body_plain: version.body_plain, failed_reviewers: agg.failed_reviewers, findings: (reviews ?? []).flatMap((r) => (r as AiReview).issues ?? []), campaign_settings: settings?.writing });

  const started = Date.now();
  let response;
  try {
    response = await dispatch({ slot: "gemini_generate", systemPrompt, userPrompt, temperature: 0.4 });
  } catch (e) {
    await transitionTicket({ ticket_id: ticketId, from: "revising", to: "needs_attention", actor_id: null, reason: `Revise failed: ${(e as Error).message}` });
    throw e;
  }
  await recordUsage({ campaign_id: ticket.campaign_id, ticket_id: ticketId, slot: "gemini_generate", provider: "gemini", model_id: response.model_id, tokens_in: response.usage?.tokens_in ?? 0, tokens_out: response.usage?.tokens_out ?? 0, duration_ms: Date.now() - started, cost_estimate_usd: estimateCost(response.model_id, response.usage?.tokens_in ?? 0, response.usage?.tokens_out ?? 0) });

  let parsed: { subject?: string; body_plain?: string; body_html?: string | null } | null = null;
  try { parsed = JSON.parse(response.text); } catch { parsed = null; }

  await sb.rpc("increment_revision_attempts", { p_ticket_id: ticketId });

  const v = await createEmailVersion({ ticket_id: ticketId, subject: parsed?.subject ?? version.subject, body_plain: parsed?.body_plain ?? version.body_plain, body_html: parsed?.body_html ? sanitizeHtml(parsed.body_html) : version.body_html, source_references: version.source_references, attachment_manifest: version.attachment_manifest, created_by: "ai" });
  await setCurrentEmailVersion(ticketId, v.id);
  await recordWorkflowEvent({ ticket_id: ticketId, campaign_id: ticket.campaign_id, stage: "quality_gate", event_type: "revision_created", metadata: { from_version: version.version_number, to_version: v.version_number, failed_reviewers: agg.failed_reviewers } });
  await transitionTicket({ ticket_id: ticketId, from: "revising", to: "humanizing", actor_id: null, reason: `Revision cycle ${ticket.revision_attempts + 1}` });
}
