import { getServiceSupabase } from "../db";
import { dispatch } from "../ai/dispatcher";
import { getPrompt, APP_SAFETY_PREAMBLE } from "../ai/prompt-registry";
import { transitionTicket, createEmailVersion, setCurrentEmailVersion, recordWorkflowEvent } from "../workflow/index";
import { recordUsage, estimateCost } from "../ai/usage-tracker";
import { sanitizeHtml } from "../validation/index";

export async function runHumanize(ticketId: string): Promise<void> {
  const sb = getServiceSupabase();
  const { data: ticket } = await sb.from("tickets").select("*").eq("id", ticketId).maybeSingle();
  if (!ticket) throw new Error(`Ticket ${ticketId} not found`);
  if (ticket.current_state !== "humanizing") return;
  if (!ticket.current_email_version_id) throw new Error("No current email version");

  const { data: version } = await sb.from("email_versions").select("*").eq("id", ticket.current_email_version_id).maybeSingle();
  if (!version) throw new Error("Email version not found");

  const systemPrompt = (await getPrompt("humanizer")) + "\n\n" + APP_SAFETY_PREAMBLE;
  const userPrompt = JSON.stringify({ subject: version.subject, body_plain: version.body_plain, body_html: version.body_html });

  const started = Date.now();
  const response = await dispatch({ slot: "gemini_generate", systemPrompt, userPrompt, temperature: 0.5 });
  await recordUsage({ campaign_id: ticket.campaign_id, ticket_id: ticketId, slot: "humanizer", provider: "gemini", model_id: response.model_id, tokens_in: response.usage?.tokens_in ?? 0, tokens_out: response.usage?.tokens_out ?? 0, duration_ms: Date.now() - started, cost_estimate_usd: estimateCost(response.model_id, response.usage?.tokens_in ?? 0, response.usage?.tokens_out ?? 0) });

  let parsed: { subject?: string; body_plain?: string; body_html?: string | null; decision?: string; editorial_score?: number } | null = null;
  try { parsed = JSON.parse(response.text); } catch { parsed = null; }

  if (!parsed) {
    await transitionTicket({ ticket_id: ticketId, from: "humanizing", to: "needs_attention", actor_id: null, reason: `Humanizer returned non-JSON (${response.text.length} chars)` });
    return;
  }
  if (parsed.decision === "blocked") {
    await transitionTicket({ ticket_id: ticketId, from: "humanizing", to: "needs_attention", actor_id: null, reason: "Humanizer blocked" });
    return;
  }

  const v = await createEmailVersion({ ticket_id: ticketId, subject: parsed.subject ?? version.subject, body_plain: parsed.body_plain ?? version.body_plain, body_html: parsed.body_html ? sanitizeHtml(parsed.body_html) : version.body_html, source_references: version.source_references, attachment_manifest: version.attachment_manifest, created_by: "ai" });
  await setCurrentEmailVersion(ticketId, v.id);
  await recordWorkflowEvent({ ticket_id: ticketId, campaign_id: ticket.campaign_id, stage: "humanization", event_type: "humanized", metadata: { version: v.version_number, decision: parsed.decision ?? "unknown", editorial_score: parsed.editorial_score ?? null } });
  await transitionTicket({ ticket_id: ticketId, from: "humanizing", to: "grok_reviews", actor_id: null });
}
