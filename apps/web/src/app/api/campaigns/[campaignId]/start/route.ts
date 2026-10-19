import { NextRequest } from "next/server";
import { getServiceSupabase, assertCampaignOwnedBy, audit } from "@mailpilot/server-core";
import { requireAuth } from "@/lib/auth";
import { ok, failInternal } from "@/lib/api/responses";
import { triggerPipeline } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ campaignId: string }> },
) {
  try {
    const { campaignId } = await ctx.params;
    const user = await requireAuth();
    await assertCampaignOwnedBy(campaignId, user.id);
    const sb = getServiceSupabase();
    await sb.from("campaigns").update({ status: "active", updated_at: new Date().toISOString() }).eq("id", campaignId);

    const { data: tickets } = await sb.from("tickets").select("id").eq("campaign_id", campaignId).eq("current_state", "queued");
    const ticketIds = (tickets ?? []).map((t) => t.id);

    await sb.from("campaign_pause_events").insert({ campaign_id: campaignId, actor_id: user.id, action: "resume" });
    await audit({ actor_id: user.id, action: "campaign.start", resource_type: "campaign", resource_id: campaignId, campaign_id: campaignId, ticket_id: null, metadata: { enqueued: ticketIds.length } });

    // Trigger analyze for each queued ticket (non-blocking, runs in background).
    for (const ticketId of ticketIds) {
      triggerPipeline({ job: "analyze", ticketId }, req.url);
    }

    return ok({ started: true, enqueued: ticketIds.length });
  } catch (e) {
    return failInternal((e as Error).message);
  }
}
