import { NextResponse } from "next/server";
import { getServiceSupabase } from "@mailpilot/server-core";
import { requireAuth, requireAdmin } from "@/lib/auth";
import { ok, fail, failInternal } from "@/lib/api/responses";
import { z } from "zod";

export const dynamic = "force-dynamic";

const Schema = z.object({
  role: z.string(),
  system_prompt: z.string().min(1),
  notes: z.string().optional(),
});

/**
 * Prompt versions — admin-only for writes, any authenticated user for reads.
 * Per §1.5: previously any authenticated user could rewrite every system
 * prompt. Now requires admin role.
 *
 * Reads are allowed for any authenticated user — the prompts are also baked
 * into the source code (BUILTIN_PROMPTS), so there's no secret here.
 */
export async function GET() {
  try {
    await requireAuth();
    const sb = getServiceSupabase();
    const { data } = await sb.from("prompt_versions").select("*").order("created_at", { ascending: false });
    return ok({ prompts: data ?? [] });
  } catch (e) {
    return failInternal((e as Error).message);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireAdmin();
    const body = await req.json();
    const parsed = Schema.safeParse(body);
    if (!parsed.success) return fail("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid", 400);
    const sb = getServiceSupabase();
    // Disable prior versions of this role, then insert the new one.
    await sb.from("prompt_versions").update({ enabled: false }).eq("role", parsed.data.role);
    const { data: latest } = await sb.from("prompt_versions").select("version").eq("role", parsed.data.role).order("version", { ascending: false }).limit(1).maybeSingle();
    const next = (latest?.version ?? 0) + 1;
    const { data } = await sb.from("prompt_versions").insert({
      role: parsed.data.role,
      version: next,
      system_prompt: parsed.data.system_prompt,
      enabled: true,
      author_id: user.id,
      notes: parsed.data.notes ?? null,
    }).select("id").single();
    return ok({ id: data?.id });
  } catch (e) {
    if ((e as Error).message.includes("Admin")) return fail("FORBIDDEN", "Admin access required", 403);
    return failInternal((e as Error).message);
  }
}
