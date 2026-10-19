import { NextResponse } from "next/server";
import { getServiceSupabase } from "@mailpilot/server-core";
import { requireAuth } from "@/lib/auth";
import { ok, failInternal } from "@/lib/api/responses";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await requireAuth();
    const sb = getServiceSupabase();
    const url = new URL(req.url);
    const importId = url.searchParams.get("import");

    // Per §6 (5th-pass): scope by user's campaigns at the SQL level, not by
    // fetching 200 rows globally and filtering in JS. The previous version
    // silently returned "No tickets yet" for any user whose tickets were
    // beyond position 200 in the global updated_at order.
    const { data: userCampaigns } = await sb.from("campaigns").select("id").eq("owner_id", user.id);
    const campaignIds = (userCampaigns ?? []).map((c) => c.id);
    if (campaignIds.length === 0) return ok({ tickets: [] });

    let q = sb
      .from("tickets")
      .select("id, recipient_email, current_state, approval_status, updated_at, campaigns(id, name, owner_id)")
      .in("campaign_id", campaignIds)
      .order("updated_at", { ascending: false })
      .limit(200);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const owned = data ?? [];

    // Optional import filter — narrow by import_rows.mapped.email.
    if (importId) {
      const { data: rows } = await sb
        .from("import_rows")
        .select("mapped")
        .eq("import_id", importId)
        .eq("status", "valid");
      const emails = (rows ?? [])
        .map((r) => (r.mapped as { email?: string } | null)?.email)
        .filter((x): x is string => Boolean(x));
      if (emails.length > 0) {
        // Filter at the SQL level for the same reason — limit(200) is already applied.
        const { data: filtered } = await sb
          .from("tickets")
          .select("id, recipient_email, current_state, approval_status, updated_at, campaigns(id, name, owner_id)")
          .in("campaign_id", campaignIds)
          .in("recipient_email", emails)
          .order("updated_at", { ascending: false })
          .limit(200);
        return ok({ tickets: filtered ?? [] });
      }
    }

    return ok({ tickets: owned });
  } catch (e) {
    return failInternal((e as Error).message);
  }
}
