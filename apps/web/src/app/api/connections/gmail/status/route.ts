import { NextResponse } from "next/server";
import { getServiceSupabase } from "@mailpilot/server-core";
import { requireAuth } from "@/lib/auth";
import { ok, failInternal } from "@/lib/api/responses";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireAuth();
    const sb = getServiceSupabase();
    const { data } = await sb.from("sender_accounts").select("email, scope, connected_at").eq("owner_id", user.id).order("connected_at", { ascending: false }).limit(1).maybeSingle();
    return ok(data ? { email: data.email, connected_at: data.connected_at } : null);
  } catch (e) {
    return failInternal((e as Error).message);
  }
}
