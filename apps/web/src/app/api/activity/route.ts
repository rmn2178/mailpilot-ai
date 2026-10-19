import { NextResponse } from "next/server";
import { getServiceSupabase } from "@mailpilot/server-core";
import { requireAuth } from "@/lib/auth";
import { ok, failInternal } from "@/lib/api/responses";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireAuth();
    const sb = getServiceSupabase();
    const { data: campaigns } = await sb.from("campaigns").select("id").eq("owner_id", user.id);
    const ids = (campaigns ?? []).map((c) => c.id);
    const { data } = ids.length
      ? await sb.from("workflow_events").select("*").in("campaign_id", ids).order("created_at", { ascending: false }).limit(200)
      : { data: [] };
    return ok({ events: data ?? [] });
  } catch (e) {
    return failInternal((e as Error).message);
  }
}
