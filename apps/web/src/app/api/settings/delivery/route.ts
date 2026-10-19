import { NextResponse } from "next/server";
import { getServiceSupabase, audit } from "@mailpilot/server-core";
import { requireAdmin } from "@/lib/auth";
import { ok, fail, failInternal } from "@/lib/api/responses";

export const dynamic = "force-dynamic";

/**
 * Global send switch — admin-only.
 * Per bug A: use a boolean jsonb value (true/false) instead of a string.
 * Supabase's postgrest-js returns jsonb as a parsed JS value, so
 * `value: true` comes back as `true` (boolean).
 */

export async function POST(req: Request) {
  try {
    const user = await requireAdmin();
    const form = await req.formData();
    const action = form.get("action");
    const sb = getServiceSupabase();
    // Store as a boolean jsonb value — unambiguous, no string-quoting issues.
    const stopped = action === "stop";
    await sb.from("global_settings").upsert({
      key: "global_send_switch",
      value: stopped,
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });
    await audit({
      actor_id: user.id,
      action: stopped ? "delivery.stop_all" : "delivery.enable",
      resource_type: "global",
      resource_id: "global_send_switch",
      campaign_id: null,
      ticket_id: null,
      metadata: {},
    });
    return ok({ stopped });
  } catch (e) {
    if ((e as Error).message.includes("Admin")) return fail("FORBIDDEN", "Admin access required", 403);
    return failInternal((e as Error).message);
  }
}
