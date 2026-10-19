import { NextRequest } from "next/server";
import { getServiceSupabase, assertCampaignOwnedBy, audit } from "@mailpilot/server-core";
import { requireAuth } from "@/lib/auth";
import { ok, failInternal, fail, failNotFound } from "@/lib/api/responses";
import { CampaignSettingsSchema } from "@mailpilot/shared";
import { z } from "zod";
import { triggerPipeline } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

// Per bug #4: do NOT use CampaignSettingsSchema.partial() — it injects
// .default() values for nested fields, which clobber existing settings on
// partial updates. Instead, accept a permissive shape and merge before
// validating against the full schema.
const PatchSchema = z.object({
  name: z.string().optional(),
  status: z.enum(["draft", "active", "paused", "completed", "archived"]).optional(),
  settings: z.object({
    writing: z.any().optional(),
    approval: z.any().optional(),
    delivery: z.any().optional(),
    revision: z.any().optional(),
  }).optional(),
});

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ campaignId: string }> },
) {
  try {
    const { campaignId } = await ctx.params;
    const user = await requireAuth();
    await assertCampaignOwnedBy(campaignId, user.id);
    const sb = getServiceSupabase();
    const { data: campaign } = await sb.from("campaigns").select("*").eq("id", campaignId).maybeSingle();
    if (!campaign) return failNotFound("Campaign");
    const { data: settings } = await sb.from("campaign_settings").select("*").eq("campaign_id", campaignId).maybeSingle();
    return ok({ campaign, settings });
  } catch (e) {
    return failInternal((e as Error).message);
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ campaignId: string }> },
) {
  try {
    const { campaignId } = await ctx.params;
    const user = await requireAuth();
    await assertCampaignOwnedBy(campaignId, user.id);
    const body = await req.json();
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) return fail("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid", 400);
    const sb = getServiceSupabase();

    if (parsed.data.name || parsed.data.status) {
      await sb.from("campaigns").update({
        ...(parsed.data.name ? { name: parsed.data.name } : {}),
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
        updated_at: new Date().toISOString(),
      }).eq("id", campaignId);

      // Per §10 (4th-pass): if the campaign is being set to "active", enqueue
      // every queued ticket for analysis — same as POST /start. A user who
      // toggles status from the settings form expects the campaign to run.
      if (parsed.data.status === "active") {
        const { data: queuedTickets } = await sb.from("tickets").select("id").eq("campaign_id", campaignId).eq("current_state", "queued");
        for (const t of queuedTickets ?? []) {
          triggerPipeline({ job: "analyze", ticketId: t.id }, req.url);
        }
      }
    }

    if (parsed.data.settings) {
      const { data: existing } = await sb.from("campaign_settings").select("*").eq("campaign_id", campaignId).maybeSingle();
      // Per bug #4: merge BEFORE validating so partial updates don't inject
      // schema defaults that clobber existing values.
      const merged = {
        writing: { ...(existing?.writing ?? {}), ...(parsed.data.settings.writing ?? {}) },
        approval: { ...(existing?.approval ?? {}), ...(parsed.data.settings.approval ?? {}) },
        delivery: { ...(existing?.delivery ?? {}), ...(parsed.data.settings.delivery ?? {}) },
        revision: { ...(existing?.revision ?? {}), ...(parsed.data.settings.revision ?? {}) },
      };
      // Validate the MERGED object against the full schema.
      const validated = CampaignSettingsSchema.safeParse(merged);
      if (!validated.success) {
        return fail("VALIDATION_ERROR", validated.error.issues[0]?.message ?? "Invalid settings", 400);
      }
      // Per §9 (NEW): use the transactional update_campaign_settings RPC.
      const { error: rpcErr } = await sb.rpc("update_campaign_settings", {
        p_campaign_id: campaignId,
        p_writing: validated.data.writing,
        p_approval: validated.data.approval,
        p_delivery: validated.data.delivery,
        p_revision: validated.data.revision,
      });
      if (rpcErr) throw new Error(`update_campaign_settings RPC failed: ${rpcErr.message}`);
    }

    await audit({
      actor_id: user.id,
      action: "campaign.update",
      resource_type: "campaign",
      resource_id: campaignId,
      campaign_id: campaignId,
      ticket_id: null,
      metadata: parsed.data,
    });

    return ok({ ok: true });
  } catch (e) {
    return failInternal((e as Error).message);
  }
}
