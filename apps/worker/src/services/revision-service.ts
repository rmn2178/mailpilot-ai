import { getServiceSupabase } from "@mailpilot/server-core";

/**
 * Revision service — collects failed checks, calls the revise processor's
 * helper logic, and tracks cycle count.
 */
export async function getFailedReviewers(ticketId: string, versionId: string): Promise<string[]> {
  const sb = getServiceSupabase();
  const { data } = await sb
    .from("ai_reviews")
    .select("reviewer_role, decision")
    .eq("ticket_id", ticketId)
    .eq("email_version_id", versionId);
  return (data ?? []).filter((r) => r.decision !== "pass").map((r) => r.reviewer_role);
}
