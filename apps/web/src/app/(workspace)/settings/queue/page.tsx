import { requireAuth } from "@/lib/auth";
import { getServiceSupabase } from "@mailpilot/server-core";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function QueueSettingsPage() {
  const user = await requireAuth();
  const sb = getServiceSupabase();

  // Per bug E: scope ticket counts by the user's campaigns at the SQL level,
  // matching every other page. The previous version queried global counts.
  const { data: userCampaigns } = await sb.from("campaigns").select("id").eq("owner_id", user.id);
  const campaignIds = (userCampaigns ?? []).map((c) => c.id);

  const { data: worker } = await sb
    .from("worker_heartbeat")
    .select("last_beat_at, queue_depth, active_jobs, failed_jobs")
    .eq("id", "singleton")
    .maybeSingle();
  // Per bug J: check heartbeat staleness — a worker that died 2 hours ago
  // should show as offline, not online.
  const lastBeatMs = worker?.last_beat_at ? new Date(worker.last_beat_at).getTime() : 0;
  const online = lastBeatMs > Date.now() - 60_000;

  let queued = 0;
  let failed = 0;
  if (campaignIds.length > 0) {
    const { count: q } = await sb
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .in("campaign_id", campaignIds)
      .in("current_state", ["queued", "retry_scheduled"]);
    queued = q ?? 0;
    const { count: f } = await sb
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .in("campaign_id", campaignIds)
      .in("current_state", ["failed", "needs_attention", "blocked"]);
    failed = f ?? 0;
  }

  return (
    <div className="p-6 max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Queue & worker</h1>
      <div className="panel panel-pad space-y-2 text-sm">
        <div className="flex items-center gap-2">
          <span className={online ? "pill-success" : "pill-danger"}>
            {online ? "online" : "offline"}
          </span>
          <span>Last heartbeat: {formatDate(worker?.last_beat_at ?? null)}</span>
        </div>
        <div>Your queued tickets: {queued}</div>
        <div>Your tickets needing attention: {failed}</div>
        <div className="text-ink-muted text-xs mt-2">
          Worker queue depth (all users): {worker?.queue_depth ?? 0} ·
          Active jobs: {worker?.active_jobs ?? 0} ·
          Failed jobs: {worker?.failed_jobs ?? 0}
        </div>
      </div>
    </div>
  );
}
