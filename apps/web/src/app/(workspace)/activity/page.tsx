import { requireAuth } from "@/lib/auth";
import { getServiceSupabase } from "@mailpilot/server-core";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  const user = await requireAuth();
  const sb = getServiceSupabase();
  const { data: campaigns } = await sb.from("campaigns").select("id").eq("owner_id", user.id);
  const ids = (campaigns ?? []).map((c) => c.id);
  const { data } = ids.length
    ? await sb
        .from("workflow_events")
        .select("id, ticket_id, campaign_id, stage, event_type, metadata, error, created_at")
        .in("campaign_id", ids)
        .order("created_at", { ascending: false })
        .limit(200)
    : { data: [] };

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
        <p className="text-sm text-ink-muted">All persisted workflow events across your campaigns.</p>
      </div>
      <div className="panel divide-y divide-line">
        {!data || data.length === 0 ? (
          <div className="px-4 py-6 text-center text-ink-muted">No activity yet.</div>
        ) : (
          data.map((e) => (
            <div key={e.id} className="px-4 py-2 text-sm flex items-start gap-3">
              <span className="pill-info">{e.stage}</span>
              <div className="flex-1">
                <div className="text-ink">{e.event_type}</div>
                {e.error && <div className="text-xs text-danger mt-0.5">{e.error}</div>}
              </div>
              <span className="text-xs text-ink-muted">{formatDate(e.created_at)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
