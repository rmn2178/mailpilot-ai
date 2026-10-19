import { getServiceSupabase } from "../db";
import { dispatch } from "../ai/dispatcher";
import { getPrompt, APP_SAFETY_PREAMBLE } from "../ai/prompt-registry";
import { transitionTicket, createEmailVersion, setCurrentEmailVersion, recordWorkflowEvent } from "../workflow/index";
import { recordUsage, estimateCost } from "../ai/usage-tracker";
import { sanitizeHtml } from "../validation/index";

export async function runGenerate(ticketId: string): Promise<void> {
  const sb = getServiceSupabase();
  const { data: ticket } = await sb.from("tickets").select("*").eq("id", ticketId).maybeSingle();
  if (!ticket) throw new Error(`Ticket ${ticketId} not found`);
  if (ticket.current_state !== "drafting") return;

  const [{ data: settings }, { data: contact }] = await Promise.all([
    sb.from("campaign_settings").select("*").eq("campaign_id", ticket.campaign_id).maybeSingle(),
    sb.from("contacts").select("*").eq("id", ticket.contact_id).maybeSingle(),
  ]);

  const systemPrompt = (await getPrompt("gemini_generate")) + "\n\n" + APP_SAFETY_PREAMBLE;
  const userPrompt = JSON.stringify({ analysis_brief: ticket.analysis_brief, campaign_settings: settings?.writing, recipient: contact, recipient_email: ticket.recipient_email });

  const started = Date.now();
  let response;
  try {
    response = await dispatch({ slot: "gemini_generate", systemPrompt, userPrompt, temperature: 0.4 });
  } catch (e) {
    await transitionTicket({ ticket_id: ticketId, from: "drafting", to: "needs_attention", actor_id: null, reason: `Generate failed: ${(e as Error).message}` });
    throw e;
  }
  await recordUsage({ campaign_id: ticket.campaign_id, ticket_id: ticketId, slot: "gemini_generate", provider: "gemini", model_id: response.model_id, tokens_in: response.usage?.tokens_in ?? 0, tokens_out: response.usage?.tokens_out ?? 0, duration_ms: Date.now() - started, cost_estimate_usd: estimateCost(response.model_id, response.usage?.tokens_in ?? 0, response.usage?.tokens_out ?? 0) });

  let parsed: { subject?: string; body_plain?: string; body_html?: string | null } | null = null;
  try { parsed = JSON.parse(response.text); } catch { parsed = null; }

  const v = await createEmailVersion({ ticket_id: ticketId, subject: parsed?.subject ?? "(no subject)", body_plain: parsed?.body_plain ?? response.text, body_html: parsed?.body_html ? sanitizeHtml(parsed.body_html) : null, source_references: [], attachment_manifest: [], created_by: "ai" });
  await setCurrentEmailVersion(ticketId, v.id);
  await recordWorkflowEvent({ ticket_id: ticketId, campaign_id: ticket.campaign_id, stage: "draft", event_type: "draft_created", metadata: { version: v.version_number } });
  await transitionTicket({ ticket_id: ticketId, from: "drafting", to: "humanizing", actor_id: null });
}
