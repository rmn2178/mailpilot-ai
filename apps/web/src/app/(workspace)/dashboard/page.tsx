import { requireAuth } from "@/lib/auth";
import { getServiceSupabase } from "@mailpilot/server-core";
import { DashboardView } from "@/components/dashboard/dashboard-view";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireAuth();
  const sb = getServiceSupabase();

  // Counts come from a security-definer RPC that filters by owner_id.
  const { data: counts } = await sb
    .rpc("dashboard_counts_for_owner", { p_owner_id: user.id })
    .maybeSingle();

  // Recent events — scoped to the user's campaigns only (ownership filter).
  const { data: userCampaigns } = await sb
    .from("campaigns")
    .select("id")
    .eq("owner_id", user.id);
  const campaignIds = (userCampaigns ?? []).map((c) => c.id);

  let recentEvents: Array<{
    id: string;
    stage: string;
    event_type: string;
    created_at: string;
    metadata: Record<string, unknown>;
    error: string | null;
    ticket_id: string | null;
  }> = [];
  if (campaignIds.length > 0) {
    const { data } = await sb
      .from("workflow_events")
      .select("id, stage, event_type, created_at, metadata, error, ticket_id")
      .in("campaign_id", campaignIds)
      .order("created_at", { ascending: false })
      .limit(10);
    recentEvents = data ?? [];
  }

  // Worker heartbeat — global singleton, safe to expose status (not secrets).
  const { data: workerRow } = await sb
    .from("worker_heartbeat")
    .select("last_beat_at, queue_depth, active_jobs, failed_jobs")
    .eq("id", "singleton")
    .maybeSingle();
  const lastBeatMs = workerRow?.last_beat_at
    ? new Date(workerRow.last_beat_at).getTime()
    : 0;
  const worker = {
    last_beat_at: workerRow?.last_beat_at ?? null,
    online: lastBeatMs > Date.now() - 60_000,
    queue_depth: workerRow?.queue_depth ?? 0,
  };

  // Providers — global config, safe to expose availability. Trim last_error
  // for non-admins so raw provider error messages (which may contain headers
  // or status details) are not leaked.
  const { data: rawProviders } = await sb
    .from("provider_settings")
    .select("slot, provider, enabled, cooldown_until, last_error")
    .order("slot");
  const { data: profile } = await sb
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const isAdmin = profile?.role === "admin";
  const providers = (rawProviders ?? []).map((p) => ({
    slot: p.slot,
    provider: p.provider,
    enabled: p.enabled,
    cooldown_until: p.cooldown_until,
    last_error: isAdmin ? p.last_error : (p.last_error ? "Provider error (admin can view details)" : null),
  }));

  // Queue backlog — scoped to the user's campaigns.
  let queueBacklog = 0;
  if (campaignIds.length > 0) {
    const { count } = await sb
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .in("campaign_id", campaignIds)
      .in("current_state", ["queued", "retry_scheduled"]);
    queueBacklog = count ?? 0;
  }

  return (
    <DashboardView
      counts={
        (counts as {
          recipients_imported: number;
          emails_processing: number;
          waiting_for_approval: number;
          approved_ready_to_send: number;
          sent: number;
          failed_or_needs_attention: number;
        }) ?? {
          recipients_imported: 0,
          emails_processing: 0,
          waiting_for_approval: 0,
          approved_ready_to_send: 0,
          sent: 0,
          failed_or_needs_attention: 0,
        }
      }
      recentEvents={recentEvents}
      worker={worker}
      providers={providers}
      queueBacklog={queueBacklog}
    />
  );
}
