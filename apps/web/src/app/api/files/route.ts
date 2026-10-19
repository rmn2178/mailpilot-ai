import { NextResponse } from "next/server";
import { getServiceSupabase, assertCampaignOwnedBy } from "@mailpilot/server-core";
import { requireAuth } from "@/lib/auth";
import { ok, failInternal } from "@/lib/api/responses";

export const dynamic = "force-dynamic";

/**
 * List files. Use GET with optional ?campaign_id= to scope; without it,
 * returns files across all of the caller's campaigns.
 *
 * Per §16 (NEW): previously exposed as POST even though it makes no writes.
 * Reverted to GET for HTTP hygiene.
 */
export async function GET(req: Request) {
  try {
    const user = await requireAuth();
    const url = new URL(req.url);
    const campaignId = url.searchParams.get("campaign_id");

    const sb = getServiceSupabase();
    if (campaignId) {
      // Scoped to a single campaign — verify ownership.
      await assertCampaignOwnedBy(campaignId, user.id);
      const { data, error } = await sb
        .from("campaign_files")
        .select("*")
        .eq("campaign_id", campaignId)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return ok({ files: data ?? [] });
    }

    const { data: campaigns } = await sb.from("campaigns").select("id").eq("owner_id", user.id);
    const ids = (campaigns ?? []).map((c) => c.id);
    const { data } = ids.length
      ? await sb.from("campaign_files").select("*").in("campaign_id", ids).order("created_at", { ascending: false })
      : { data: [] };
    return ok({ files: data ?? [] });
  } catch (e) {
    return failInternal((e as Error).message);
  }
}
