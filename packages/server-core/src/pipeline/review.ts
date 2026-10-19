import { getServiceSupabase } from "../db";
import { dispatch } from "../ai/dispatcher";
import { getPrompt, APP_SAFETY_PREAMBLE } from "../ai/prompt-registry";
import { recordUsage, estimateCost } from "../ai/usage-tracker";
import type { ReviewerRole } from "@mailpilot/shared";

export async function runReview(ticketId: string, role: ReviewerRole, emailVersionId: string): Promise<void> {
  const sb = getServiceSupabase();

  const [{ data: ticket }, { data: version }] = await Promise.all([
    sb.from("tickets").select("*").eq("id", ticketId).maybeSingle(),
    sb.from("email_versions").select("*").eq("id", emailVersionId).maybeSingle(),
  ]);
  if (!ticket || !version) throw new Error("Ticket or version missing");

  const { data: existing } = await sb.from("ai_reviews").select("id, status").eq("ticket_id", ticketId).eq("email_version_id", emailVersionId).eq("reviewer_role", role).maybeSingle();
  if (existing && existing.status !== "running") {
    await checkAndAdvance(ticketId, emailVersionId, role.startsWith("grok") ? "grok_reviews" : "gemini_qa");
    return;
  }

  const systemPrompt = (await getPrompt(role)) + "\n\n" + APP_SAFETY_PREAMBLE;
  const userPrompt = JSON.stringify({ subject: version.subject, body_plain: version.body_plain, body_html: version.body_html, recipient_email: ticket.recipient_email, version_id: version.id, version_number: version.version_number, analysis_brief: ticket.analysis_brief ?? null });

  const startedAt = new Date().toISOString();
  const started = Date.now();

  let status: "completed" | "failed" = "completed";
  let decision: "pass" | "revise" | "blocked" | "error" = "error";
  let score: number | null = null;
  let summary = "";
  let issues: unknown[] = [];
  let evidence_references: string[] = [];
  let errorCode: string | null = null;
  let actualModelId = role.startsWith("grok") ? "grok-2-latest" : "gemini-1.5-pro";
  const actualProvider: "grok" | "gemini" = role.startsWith("grok") ? "grok" : "gemini";

  try {
    const response = await dispatch({ slot: role, systemPrompt, userPrompt, temperature: 0.2 });
    actualModelId = response.model_id;
    await recordUsage({ campaign_id: ticket.campaign_id, ticket_id: ticketId, slot: role, provider: actualProvider, model_id: response.model_id, tokens_in: response.usage?.tokens_in ?? 0, tokens_out: response.usage?.tokens_out ?? 0, duration_ms: Date.now() - started, cost_estimate_usd: estimateCost(response.model_id, response.usage?.tokens_in ?? 0, response.usage?.tokens_out ?? 0) });

    let parsed: { decision?: string; score?: number; summary?: string; issues?: unknown[]; evidence_references?: string[] } | null = null;
    try { parsed = JSON.parse(response.text); } catch { status = "failed"; decision = "error"; errorCode = "PARSE_ERROR"; summary = `Non-JSON response (${response.text.length} chars)`; }

    if (parsed) {
      const d = parsed.decision;
      if (d === "pass" || d === "revise" || d === "blocked") { decision = d; }
      else { decision = "error"; errorCode = "UNKNOWN_DECISION"; summary = `Unknown decision: ${d ?? "(missing)"}`; status = "failed"; }
      if (typeof parsed.score === "number") score = parsed.score;
      if (!summary) summary = (parsed.summary as string) || "";
      issues = Array.isArray(parsed.issues) ? parsed.issues : [];
      evidence_references = Array.isArray(parsed.evidence_references) ? parsed.evidence_references as string[] : [];
    }
  } catch (e) {
    status = "failed"; decision = "error"; errorCode = (e as Error).name || "PROVIDER_ERROR"; summary = (e as Error).message;
  }

  const reviewRow = { ticket_id: ticketId, email_version_id: emailVersionId, reviewer_role: role, provider: actualProvider, model_id: actualModelId, status, score, decision, issues, evidence_references, summary, started_at: startedAt, completed_at: new Date().toISOString(), duration_ms: Date.now() - started, usage_metadata: null, error_code: errorCode };

  if (existing) {
    await sb.from("ai_reviews").update(reviewRow).eq("id", existing.id);
  } else {
    await sb.from("ai_reviews").insert(reviewRow);
  }

  await checkAndAdvance(ticketId, emailVersionId, role.startsWith("grok") ? "grok_reviews" : "gemini_qa");
}

const GROK_ROLES: ReviewerRole[] = ["grok_defensibility", "grok_human_tone", "grok_content_fit", "grok_delivery_hygiene"];
const QA_ROLES: ReviewerRole[] = ["gemini_qa_structure", "gemini_qa_personalization"];

async function checkAndAdvance(ticketId: string, versionId: string, stage: "grok_reviews" | "gemini_qa"): Promise<void> {
  const sb = getServiceSupabase();
  const { data: ticket } = await sb.from("tickets").select("current_state, campaign_id").eq("id", ticketId).maybeSingle();
  if (!ticket || ticket.current_state !== stage) return;

  const roles = stage === "grok_reviews" ? GROK_ROLES : QA_ROLES;
  const { data: reviews } = await sb.from("ai_reviews").select("reviewer_role, status").eq("ticket_id", ticketId).eq("email_version_id", versionId);
  const complete = roles.every((r) => { const found = (reviews ?? []).find((x) => x.reviewer_role === r); return found && found.status !== "running"; });
  if (!complete) return;

  if (stage === "grok_reviews") {
    const { data: ok } = await sb.rpc("atomic_transition_ticket", { p_ticket_id: ticketId, p_from: "grok_reviews", p_to: "gemini_qa" });
    if (!ok) return;
  } else {
    const { data: ok } = await sb.rpc("atomic_transition_ticket", { p_ticket_id: ticketId, p_from: "gemini_qa", p_to: "quality_gate" });
    if (!ok) return;
  }
}
