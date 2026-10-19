import { requireAuth } from "@/lib/auth";
import { getServiceSupabase } from "@mailpilot/server-core";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ import?: string }>;
}) {
  const { import: importId } = await searchParams;
  const user = await requireAuth();
  const sb = getServiceSupabase();

  // Per §6 (5th-pass): scope by user's campaigns at the SQL level so users
  // with large datasets don't see empty lists because their tickets fell
  // beyond position 200 in the global order.
  const { data: userCampaigns } = await sb.from("campaigns").select("id").eq("owner_id", user.id);
  const campaignIds = (userCampaigns ?? []).map((c) => c.id);

  let owned: Array<{
    id: string;
    recipient_email: string;
    current_state: string;
    approval_status: string;
    updated_at: string;
    campaigns: Array<{ id: string; name: string; owner_id: string }> | { id: string; name: string; owner_id: string } | null;
  }> = [];

  if (campaignIds.length > 0) {
    const { data } = await sb
      .from("tickets")
      .select("id, recipient_email, current_state, approval_status, updated_at, campaigns(id, name, owner_id)")
      .in("campaign_id", campaignIds)
      .order("updated_at", { ascending: false })
      .limit(200);
    owned = (data ?? []) as typeof owned;
  }

  if (importId) {
    const { data: rows } = await sb
      .from("import_rows")
      .select("mapped")
      .eq("import_id", importId)
      .eq("status", "valid");
    const emails = (rows ?? [])
      .map((r) => (r.mapped as { email?: string } | null)?.email)
      .filter((x): x is string => Boolean(x));
    if (emails.length > 0) {
      owned = owned.filter((t) => emails.includes(t.recipient_email));
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tickets</h1>
        <p className="text-sm text-ink-muted">
          One ticket per eligible recipient. Click a row to open the workspace.
        </p>
      </div>
      <div className="panel">
        <table className="w-full text-sm">
          <thead className="text-ink-muted text-xs uppercase">
            <tr className="border-b border-line">
              <th className="text-left font-medium px-4 py-2">Recipient</th>
              <th className="text-left font-medium px-4 py-2">Campaign</th>
              <th className="text-left font-medium px-4 py-2">State</th>
              <th className="text-left font-medium px-4 py-2">Approval</th>
              <th className="text-left font-medium px-4 py-2">Updated</th>
            </tr>
          </thead>
          <tbody>
            {owned.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink-muted">
                  No tickets yet.
                </td>
              </tr>
            ) : (
              owned.map((t) => {
                const c = Array.isArray(t.campaigns) ? t.campaigns[0] : t.campaigns;
                return (
                  <tr key={t.id} className="border-b border-line last:border-0 hover:bg-bg-subtle/50">
                    <td className="px-4 py-2">
                      <Link href={`/tickets/${t.id}`} className="text-ink hover:text-brand">
                        {t.recipient_email}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-ink-muted">{c?.name ?? "—"}</td>
                    <td className="px-4 py-2 capitalize">{t.current_state.replace(/_/g, " ")}</td>
                    <td className="px-4 py-2 capitalize">{t.approval_status.replace(/_/g, " ")}</td>
                    <td className="px-4 py-2 text-ink-muted">{new Date(t.updated_at).toLocaleString()}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
