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

    // Enqueue every queued ticket for analysis. The workflow orchestrator
    // (worker side) is the single source of truth for subsequent stage
    // advancement — analyze.processor.ts will call orchestrate() to chain
    // to generate → humanize → reviews → qa → quality_gate → approval.
    const { data: tickets } = await sb
      .from("tickets")
      .select("id")
      .eq("campaign_id", campaignId)
      .eq("current_state", "queued");
    let enqueued = 0;
    for (const t of tickets ?? []) {
      await enqueueIdempotent(
        QUEUE_NAMES.analysis,
        "analyze",
        { ticketId: t.id },
        `analyze-${t.id}`,
      );
      enqueued += 1;
    }

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
    return ok({ started: true, enqueued });
  } catch (e) {
    return failInternal((e as Error).message);
  }
}
