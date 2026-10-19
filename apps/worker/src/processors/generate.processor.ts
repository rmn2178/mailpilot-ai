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
 * Generation processor.
 *
 * Idempotent: if retried and the ticket is no longer in `drafting`, no-op.
 * Sanitizes AI-generated HTML before persistence.
 */
export async function processGenerate(job: Job<{ ticketId: string }>): Promise<void> {
  const { ticketId } = job.data;
  const sb = getServiceSupabase();

  const { data: ticket } = await sb.from("tickets").select("*").eq("id", ticketId).maybeSingle();
  if (!ticket) throw new Error(`Ticket ${ticketId} not found`);
  if (ticket.current_state !== "drafting") return;

  const [{ data: settings }, { data: contact }] = await Promise.all([
    sb.from("campaign_settings").select("*").eq("campaign_id", ticket.campaign_id).maybeSingle(),
    sb.from("contacts").select("*").eq("id", ticket.contact_id).maybeSingle(),
  ]);

  const systemPrompt = (await getPrompt("gemini_generate")) + "\n\n" + APP_SAFETY_PREAMBLE;
  // Per §3 (NEW): thread the persisted analysis brief through to the generator.
  // The generate prompt says "Follow the approved brief exactly" — without
  // this, the two-stage pipeline collapses and the generator re-derives
  // objective/sections/style from scratch.
  const userPrompt = JSON.stringify({
    analysis_brief: ticket.analysis_brief,
    campaign_settings: settings?.writing,
    recipient: contact,
    recipient_email: ticket.recipient_email,
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
  try {
    parsed = JSON.parse(response.text);
  } catch {
    parsed = null;
  }
  const subject = parsed?.subject ?? "(no subject)";
  const body_plain = parsed?.body_plain ?? response.text;
  // Sanitize AI-generated HTML before persisting. Per §5.6.
  const body_html = parsed?.body_html ? sanitizeHtml(parsed.body_html) : null;

  const v = await createEmailVersion({
    ticket_id: ticketId,
    subject,
    body_plain,
    body_html,
    source_references: parsed ? [] : [{ note: "raw response stored", model: response.model_id }],
    attachment_manifest: [],
    created_by: "ai",
  });
  await setCurrentEmailVersion(ticketId, v.id);

  await recordWorkflowEvent({
    ticket_id: ticketId,
    campaign_id: ticket.campaign_id,
    stage: "draft",
    event_type: "draft_created",
    metadata: { version: v.version_number },
  });

  await transitionTicket({
    ticket_id: ticketId,
    from: "drafting",
    to: "humanizing",
    actor_id: null,
  });
  const { orchestrate } = await import("../services/workflow-orchestrator");
  await orchestrate(ticketId);
}
