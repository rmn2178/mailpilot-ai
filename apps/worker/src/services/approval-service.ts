import { getServiceSupabase, loadEnv } from "@mailpilot/server-core";
import { resolveRequiredReviewers } from "@mailpilot/shared";

/**
 * Approval service — centralizes auto-approval eligibility checks.
 *
 * Per spec §12, auto-approval requires ALL of:
 *   - All mandatory reviewers passed
 *   - All required Gemini QA checks passed
 *   - Scores meet configured thresholds
 *   - No critical or unresolved material issue exists
 *   - Required sections are present
 *   - Recipient eligibility is valid
 *   - The reviewed version remains the current version
 *   - Attachments and relevant references remain unchanged since validation
 *   - Campaign sending limits and global safety controls allow delivery
 *
 * Per bug L: the previous version only checked reviews and scores. Now also
 * checks suppression list, sending caps, and permitted hours.
 */
export async function canAutoApprove(ticketId: string): Promise<{ ok: boolean; reasons: string[] }> {
  const sb = getServiceSupabase();
  const { data: ticket } = await sb.from("tickets").select("*").eq("id", ticketId).maybeSingle();
  if (!ticket) return { ok: false, reasons: ["ticket not found"] };
  const { data: settings } = await sb.from("campaign_settings").select("*").eq("campaign_id", ticket.campaign_id).maybeSingle();
  if (!settings) return { ok: false, reasons: ["no campaign settings"] };
  const approval = settings.approval as { mode?: string; min_score?: number; required_reviewers?: string[] };
  if (approval.mode !== "auto") return { ok: false, reasons: ["auto-approval not enabled"] };

  const reasons: string[] = [];
  const { data: reviews } = await sb.from("ai_reviews").select("*").eq("ticket_id", ticketId).eq("email_version_id", ticket.current_email_version_id);
  const requiredReviewers = resolveRequiredReviewers(approval.required_reviewers);
  if ((reviews ?? []).length === 0) {
    reasons.push("no reviews recorded for this version");
  }
  for (const r of requiredReviewers) {
    const found = (reviews ?? []).find((x) => x.reviewer_role === r);
    if (!found) reasons.push(`required reviewer ${r} missing`);
    else if (found.decision !== "pass") reasons.push(`${r} decision is ${found.decision}`);
    else if (typeof found.score === "number" && found.score < (approval.min_score ?? 70)) {
      reasons.push(`${r} score ${found.score} < ${approval.min_score ?? 70}`);
    }
  }
  if ((reviews ?? []).some((r) => r.issues.some((i: { severity: string }) => i.severity === "critical"))) {
    reasons.push("critical issue found in at least one review");
  }

  // Per bug L: check suppression list.
  const { data: suppressed } = await sb.from("suppression_list").select("email").eq("email", ticket.recipient_email).maybeSingle();
  if (suppressed) {
    reasons.push("recipient is on suppression list");
  }

  // Per bug L: check global send switch.
  const { data: gs } = await sb.from("global_settings").select("value").eq("key", "global_send_switch").maybeSingle();
  const gsRaw = gs?.value;
  if (gsRaw === true || gsRaw === "stopped" || gsRaw === '"stopped"') {
    reasons.push("global send switch is stopped");
  }

  // Per bug L: check campaign sending caps and permitted hours.
  const delivery = (settings.delivery ?? {}) as { max_per_hour?: number; max_per_day?: number; permitted_hours?: { start: number; end: number } };
  const env = loadEnv();
  const tz = env.DEFAULT_TIMEZONE || "UTC";
  const now = new Date();
  const hourStr = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    hour12: false,
  }).format(now);
  const hour = parseInt(hourStr, 10);
  const permitted = delivery.permitted_hours ?? { start: 9, end: 18 };
  if (hour < permitted.start || hour >= permitted.end) {
    reasons.push(`outside permitted sending hours (${permitted.start}:00–${permitted.end}:00 ${tz})`);
  }
  if (delivery.max_per_hour) {
    const { data: hourCount } = await sb.rpc("count_recent_sends", { p_campaign_id: ticket.campaign_id, p_window_seconds: 3600 });
    if ((hourCount ?? 0) >= delivery.max_per_hour) {
      reasons.push(`campaign hour cap reached (${delivery.max_per_hour}/hour)`);
    }
  }
  if (delivery.max_per_day) {
    const { data: dayCount } = await sb.rpc("count_recent_sends", { p_campaign_id: ticket.campaign_id, p_window_seconds: 86400 });
    if ((dayCount ?? 0) >= delivery.max_per_day) {
      reasons.push(`campaign day cap reached (${delivery.max_per_day}/day)`);
    }
  }

  return { ok: reasons.length === 0, reasons };
}
