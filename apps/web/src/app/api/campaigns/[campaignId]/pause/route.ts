import { NextResponse } from "next/server";
import { getServiceSupabase, assertCampaignOwnedBy, audit } from "@mailpilot/server-core";
import { requireAuth } from "@/lib/auth";
import { ok, failInternal } from "@/lib/api/responses";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ campaignId: string }> },
) {
  try {
    const { campaignId } = await ctx.params;
    const user = await requireAuth();
    await assertCampaignOwnedBy(campaignId, user.id);
    const sb = getServiceSupabase();
    await sb.from("campaigns").update({ status: "paused", updated_at: new Date().toISOString() }).eq("id", campaignId);
    await sb.from("campaign_pause_events").insert({
      campaign_id: campaignId,
      actor_id: user.id,
      action: "pause",
    });
    await audit({
      actor_id: user.id,
      action: "campaign.pause",
      resource_type: "campaign",
      resource_id: campaignId,
      campaign_id: campaignId,
      ticket_id: null,
      metadata: {},
    });
    return ok({ paused: true });
  } catch (e) {
    return failInternal((e as Error).message);
  }
}
