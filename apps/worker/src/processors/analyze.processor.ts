import type { Job } from "bullmq";
import {
  getServiceSupabase,
  dispatch,
  getPrompt,
  APP_SAFETY_PREAMBLE,
  transitionTicket,
  recordWorkflowEvent,
  recordUsage,
  estimateCost,
} from "@mailpilot/server-core";

/**
 * Analysis processor.
 *
 * Retry-safety: we use `atomic_transition_ticket` for the queued→analyzing
 * transition. If a retry re-runs the job, the transition returns NULL (the
 * ticket is no longer in `queued`), and we re-read the ticket. If it's
 * already in `analyzing`, we proceed with the AI call. If it's already past
 * `analyzing`, we no-op.
 */
export async function processAnalyze(job: Job<{ ticketId: string }>): Promise<void> {
  const { ticketId } = job.data;
  const sb = getServiceSupabase();

  const { data: ticket } = await sb.from("tickets").select("*").eq("id", ticketId).maybeSingle();
  if (!ticket) throw new Error(`Ticket ${ticketId} not found`);

  // Idempotent transition: queued → analyzing. If already analyzing, proceed.
  if (ticket.current_state === "queued") {
    const { data: ok } = await sb.rpc("atomic_transition_ticket", {
      p_ticket_id: ticketId,
      p_from: "queued",
      p_to: "analyzing",
    });
    if (!ok) {
      // Someone else advanced it; re-read.
      const { data: refreshed } = await sb.from("tickets").select("current_state").eq("id", ticketId).maybeSingle();
      if (refreshed && refreshed.current_state !== "analyzing") return;
    }
  } else if (ticket.current_state !== "analyzing") {
    return; // Already past this stage.
  }

  const [{ data: campaign }, { data: settings }, { data: contact }, { data: files }] = await Promise.all([
    sb.from("campaigns").select("*").eq("id", ticket.campaign_id).maybeSingle(),
    sb.from("campaign_settings").select("*").eq("campaign_id", ticket.campaign_id).maybeSingle(),
    sb.from("contacts").select("*").eq("id", ticket.contact_id).maybeSingle(),
    sb.from("campaign_files").select("filename, extraction_text, extraction_failure").eq("campaign_id", ticket.campaign_id).eq("extraction_status", "completed"),
  ]);

  const systemPrompt = (await getPrompt("gemini_analyze")) + "\n\n" + APP_SAFETY_PREAMBLE;
  const userPrompt = JSON.stringify({
    campaign: { name: campaign?.name, settings: settings?.writing },
    recipient: contact,
    source_files: (files ?? []).map((f) => ({ filename: f.filename, content: f.extraction_text, failure: f.extraction_failure })),
  });

  const started = Date.now();
  let response;
  try {
    response = await dispatch({
      slot: "gemini_analyze",
      systemPrompt,
      userPrompt,
      temperature: 0.2,
    });
  } catch (e) {
    await transitionTicket({
      ticket_id: ticketId,
      from: "analyzing",
      to: "needs_attention",
      actor_id: null,
      reason: `Analysis failed: ${(e as Error).message}`,
    });
    throw e;
  }

  await recordUsage({
    campaign_id: ticket.campaign_id,
    ticket_id: ticketId,
    slot: "gemini_analyze",
    provider: "gemini",
    model_id: response.model_id,
    tokens_in: response.usage?.tokens_in ?? 0,
    tokens_out: response.usage?.tokens_out ?? 0,
    duration_ms: Date.now() - started,
    cost_estimate_usd: estimateCost(response.model_id, response.usage?.tokens_in ?? 0, response.usage?.tokens_out ?? 0),
  });

  // Persist the analysis brief on the ticket row. The generator and reviewers
  // read this field to ground their output — without it the two-stage
  // pipeline collapses to a single-stage generator.
  let brief: unknown = null;
  try {
    brief = JSON.parse(response.text);
  } catch {
    brief = { raw: response.text.slice(0, 4000) };
  }
  await sb.from("tickets").update({
    analysis_brief: brief,
    updated_at: new Date().toISOString(),
  }).eq("id", ticketId);

  // Per §26: operational telemetry must not contain full email content.
  // workflow_events records token counts; the brief itself lives on the
  // tickets row where RLS protects it.
  await recordWorkflowEvent({
    ticket_id: ticketId,
    campaign_id: ticket.campaign_id,
    stage: "analysis",
    event_type: "analysis_completed",
    metadata: {
      tokens_in: response.usage?.tokens_in ?? 0,
      tokens_out: response.usage?.tokens_out ?? 0,
      duration_ms: Date.now() - started,
      brief_keys: brief && typeof brief === "object" ? Object.keys(brief as object) : [],
    },
  });

  // Advance to drafting and enqueue the generate job via the orchestrator.
  await transitionTicket({
    ticket_id: ticketId,
    from: "analyzing",
    to: "drafting",
    actor_id: null,
  });
  const { orchestrate } = await import("../services/workflow-orchestrator");
  await orchestrate(ticketId);
}
