import { NextResponse } from "next/server";
import { getServiceSupabase } from "@mailpilot/server-core";
import { requireAdmin } from "@/lib/auth";
import { ok, fail, failInternal } from "@/lib/api/responses";
import { z } from "zod";

const PatchSchema = z.object({
  slot: z.string(),
  model_id: z.string().optional(),
  credential_slot: z.number().int().min(1).max(4).optional(),
  enabled: z.boolean().optional(),
  max_concurrency: z.number().int().min(1).optional(),
  request_budget_per_minute: z.number().int().min(1).optional(),
  timeout_ms: z.number().int().min(1000).optional(),
});

/**
 * Provider settings — admin-only.
 * Per §1.6: previously any authenticated user could rewrite model IDs,
 * credential slots, and budgets. Now requires admin role.
 */
export async function PATCH(req: Request) {
  try {
    await requireAdmin();
    const body = await req.json();
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) return fail("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid", 400);
    const sb = getServiceSupabase();
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (parsed.data.model_id !== undefined) update.model_id = parsed.data.model_id;
    if (parsed.data.credential_slot !== undefined) update.credential_slot = parsed.data.credential_slot;
    if (parsed.data.enabled !== undefined) update.enabled = parsed.data.enabled;
    if (parsed.data.max_concurrency !== undefined) update.max_concurrency = parsed.data.max_concurrency;
    if (parsed.data.request_budget_per_minute !== undefined) update.request_budget_per_minute = parsed.data.request_budget_per_minute;
    if (parsed.data.timeout_ms !== undefined) update.timeout_ms = parsed.data.timeout_ms;
    const { error } = await sb.from("provider_settings").update(update).eq("slot", parsed.data.slot);
    if (error) throw new Error(error.message);
    return ok({ ok: true });
  } catch (e) {
    if ((e as Error).message.includes("Admin")) return fail("FORBIDDEN", "Admin access required", 403);
    return failInternal((e as Error).message);
  }
}
