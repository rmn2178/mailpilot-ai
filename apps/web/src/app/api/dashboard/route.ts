import { NextResponse } from "next/server";
import { getServiceSupabase } from "@mailpilot/server-core";
import { requireAuth } from "@/lib/auth";
import { ok, failInternal } from "@/lib/api/responses";

export const dynamic = "force-dynamic";

/**
 * Dashboard API — returns the same data the dashboard page renders, scoped to
 * the calling user's campaigns.
 *
 * Per §3 (5th-pass): the previous version queried the global top-10
 * workflow_events without a campaign filter, leaking other users' activity.
 */
export async function GET() {
  try {
    const user = await requireAuth();
    const sb = getServiceSupabase();
    const { data: counts } = await sb.rpc("dashboard_counts_for_owner", { p_owner_id: user.id }).maybeSingle();

    // Per §13 (5th-pass): only expose the online boolean + last_beat timestamp
    // for non-admin callers. The raw worker_heartbeat row contains queue_depth
    // and active_jobs counts that don't need to be public.
    const { data: worker } = await sb.from("worker_heartbeat").select("last_beat_at, queue_depth, active_jobs, failed_jobs").eq("id", "singleton").maybeSingle();
    const lastBeatMs = worker?.last_beat_at ? new Date(worker.last_beat_at).getTime() : 0;
    const workerOnline = lastBeatMs > Date.now() - 60_000;

    // Provider availability — global, but trim last_error for non-admins.
    const { data: rawProviders } = await sb.from("provider_settings").select("slot, provider, enabled, cooldown_until, last_error").order("slot");
    const { data: profile } = await sb.from("profiles").select("role").eq("id", user.id).maybeSingle();
    const isAdmin = profile?.role === "admin";
    const providers = (rawProviders ?? []).map((p) => ({
      slot: p.slot,
      provider: p.provider,
      enabled: p.enabled,
      cooldown_until: p.cooldown_until,
      last_error: isAdmin ? p.last_error : (p.last_error ? "Provider error (admin can view details)" : null),
    }));

    // Scope backlog + recent events by the user's campaigns.
    const { data: userCampaigns } = await sb.from("campaigns").select("id").eq("owner_id", user.id);
    const campaignIds = (userCampaigns ?? []).map((c) => c.id);
    let queueBacklog = 0;
    let recent: Array<{ id: string; stage: string; event_type: string; created_at: string; metadata: Record<string, unknown>; error: string | null; ticket_id: string | null }> = [];
    if (campaignIds.length > 0) {
      const { count } = await sb.from("tickets").select("id", { count: "exact", head: true }).in("campaign_id", campaignIds).in("current_state", ["queued", "retry_scheduled"]);
      queueBacklog = count ?? 0;
      const { data: recentData } = await sb
        .from("workflow_events")
        .select("id, stage, event_type, created_at, metadata, error, ticket_id")
        .in("campaign_id", campaignIds)
        .order("created_at", { ascending: false })
        .limit(10);
      recent = recentData ?? [];
    }

    return ok({
      totals: counts ?? {
        recipients_imported: 0,
        emails_processing: 0,
        waiting_for_approval: 0,
        approved_ready_to_send: 0,
        sent: 0,
        failed_or_needs_attention: 0,
      },
      queue: { backlog: queueBacklog },
      worker: { online: workerOnline, last_heartbeat_at: worker?.last_beat_at ?? null },
      providers,
      recent_activity: recent,
    });
  } catch (e) {
    return failInternal((e as Error).message);
  }
}
