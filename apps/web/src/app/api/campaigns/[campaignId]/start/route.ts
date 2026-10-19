import { NextResponse } from "next/server";
import { getServiceSupabase, assertCampaignOwnedBy, audit, enqueueIdempotent, QUEUE_NAMES } from "@mailpilot/server-core";
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
    await sb.from("campaigns").update({ status: "active", updated_at: new Date().toISOString() }).eq("id", campaignId);

    const { data: tickets } = await sb
      .from("tickets")
      .select("id")
      .eq("campaign_id", campaignId)
      .eq("current_state", "queued");

    const ticketIds = (tickets ?? []).map((t) => t.id);
    const enqueued = ticketIds.length;

    await sb.from("campaign_pause_events").insert({
      campaign_id: campaignId,
      actor_id: user.id,
      action: "resume",
    });
    await audit({
      actor_id: user.id,
      action: "campaign.start",
      resource_type: "campaign",
      resource_id: campaignId,
      campaign_id: campaignId,
      ticket_id: null,
      metadata: { enqueued },
    });

    // Fire and forget — enqueue after returning so the serverless function
    // doesn't block or timeout on Redis. Worker's recovery sweep handles
    // any tickets missed if Redis is temporarily unavailable.
    void (async () => {
      try {
        for (const ticketId of ticketIds) {
          await enqueueIdempotent(
            QUEUE_NAMES.analysis,
            "analyze",
            { ticketId },
            `analyze-${ticketId}`,
          );
        }
      } catch (e) {
        console.error("[start] enqueue failed (worker will recover):", (e as Error).message);
      }
    })();

    return ok({ started: true, enqueued });
  } catch (e) {
    return failInternal((e as Error).message);
  }
}
