import { requireAuth } from "@/lib/auth";
import { getServiceSupabase } from "@mailpilot/server-core";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function NeedsAttentionPage() {
  const user = await requireAuth();
  const sb = getServiceSupabase();

  // Per §6 (5th-pass): scope by user's campaigns at the SQL level.
  const { data: userCampaigns } = await sb.from("campaigns").select("id").eq("owner_id", user.id);
  const campaignIds = (userCampaigns ?? []).map((c) => c.id);

  let owned: Array<{
    id: string;
    recipient_email: string;
    current_state: string;
    last_error: string | null;
    updated_at: string;
    campaigns: Array<{ id: string; name: string; owner_id: string }> | { id: string; name: string; owner_id: string } | null;
  }> = [];
  if (campaignIds.length > 0) {
    const { data } = await sb
      .from("tickets")
      .select("id, recipient_email, current_state, last_error, updated_at, campaigns(id, name, owner_id)")
      .in("campaign_id", campaignIds)
      .in("current_state", ["needs_attention", "blocked", "failed", "send_status_unknown"])
      .order("updated_at", { ascending: false })
      .limit(200);
    owned = (data ?? []) as typeof owned;
  }

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Needs attention</h1>
        <p className="text-sm text-ink-muted">
          Tickets in needs_attention / blocked / failed / send_status_unknown states.
          Click a row to investigate and retry.
        </p>
      </div>
      <div className="panel">
        <table className="w-full text-sm">
          <thead className="text-ink-muted text-xs uppercase">
            <tr className="border-b border-line">
              <th className="text-left font-medium px-4 py-2">Recipient</th>
              <th className="text-left font-medium px-4 py-2">State</th>
              <th className="text-left font-medium px-4 py-2">Error</th>
              <th className="text-left font-medium px-4 py-2">Updated</th>
            </tr>
          </thead>
          <tbody>
            {owned.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-ink-muted">
                  Nothing needs attention.
                </td>
              </tr>
            ) : (
              owned.map((t) => (
                <tr key={t.id} className="border-b border-line last:border-0 hover:bg-bg-subtle/50">
                  <td className="px-4 py-2">
                    <Link href={`/tickets/${t.id}`} className="text-ink hover:text-brand">
                      {t.recipient_email}
                    </Link>
                  </td>
                  <td className="px-4 py-2 capitalize">{t.current_state.replace(/_/g, " ")}</td>
                  <td className="px-4 py-2 text-danger text-xs">{t.last_error ?? "—"}</td>
                  <td className="px-4 py-2 text-ink-muted">{new Date(t.updated_at).toLocaleString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
