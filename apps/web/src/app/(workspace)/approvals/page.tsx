import { requireAuth } from "@/lib/auth";
import { getServiceSupabase } from "@mailpilot/server-core";
import { ApprovalsTable } from "@/components/approvals/approvals-table";

export const dynamic = "force-dynamic";

interface ApprovalTicket {
  id: string;
  recipient_email: string;
  approval_status: string;
  updated_at: string;
  current_email_version_id: string | null;
  campaigns: Array<{ id: string; name: string; owner_id: string }> | { id: string; name: string; owner_id: string } | null;
}

export default async function ApprovalsPage() {
  const user = await requireAuth();
  const sb = getServiceSupabase();

  // Per §6 (5th-pass): scope by user's campaigns at the SQL level.
  const { data: userCampaigns } = await sb.from("campaigns").select("id").eq("owner_id", user.id);
  const campaignIds = (userCampaigns ?? []).map((c) => c.id);

  let owned: ApprovalTicket[] = [];
  if (campaignIds.length > 0) {
    const { data: tickets } = await sb
      .from("tickets")
      .select("id, recipient_email, current_state, approval_status, current_email_version_id, updated_at, campaigns(id, name, owner_id)")
      .in("campaign_id", campaignIds)
      .eq("current_state", "pending_approval")
      .order("updated_at", { ascending: false });
    owned = (tickets ?? []) as unknown as ApprovalTicket[];
  }

  const filtered = owned.map((t) => ({
    id: t.id,
    recipient_email: t.recipient_email,
    approval_status: t.approval_status,
    updated_at: t.updated_at,
    current_email_version_id: t.current_email_version_id,
    campaigns: Array.isArray(t.campaigns) ? t.campaigns[0] ?? null : t.campaigns,
  }));

  const versionIds = filtered
    .map((t) => t.current_email_version_id)
    .filter((x): x is string => Boolean(x));

  const { data: versions } = await sb
    .from("email_versions")
    .select("id, subject, version_number")
    .in("id", versionIds);

  const { data: reviews } = await sb
    .from("ai_reviews")
    .select("ticket_id, reviewer_role, decision, score")
    .in("email_version_id", versionIds);

  return <ApprovalsTable tickets={filtered} versions={versions ?? []} reviews={reviews ?? []} />;
}
