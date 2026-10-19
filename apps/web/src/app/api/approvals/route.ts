import { requireAuth } from "@/lib/auth";
import { getServiceSupabase } from "@mailpilot/server-core";
import { ok, failInternal } from "@/lib/api/responses";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireAuth();
    const sb = getServiceSupabase();

    // Per §6 (5th-pass): scope by user's campaigns at the SQL level.
    const { data: userCampaigns } = await sb.from("campaigns").select("id").eq("owner_id", user.id);
    const campaignIds = (userCampaigns ?? []).map((c) => c.id);
    if (campaignIds.length === 0) return ok({ tickets: [] });

    const { data, error } = await sb
      .from("tickets")
      .select("id, recipient_email, current_state, approval_status, current_email_version_id, updated_at, campaigns(id, name, owner_id)")
      .in("campaign_id", campaignIds)
      .in("current_state", ["pending_approval", "approved"])
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);

    return ok({ tickets: data ?? [] });
  } catch (e) {
    return failInternal((e as Error).message);
  }
}
