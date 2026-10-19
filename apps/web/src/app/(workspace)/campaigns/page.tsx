import { requireAuth } from "@/lib/auth";
import { getServiceSupabase } from "@mailpilot/server-core";
import Link from "next/link";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const user = await requireAuth();
  const sb = getServiceSupabase();
  const { data } = await sb
    .from("campaigns")
    .select("id, name, status, created_at, updated_at")
    .eq("owner_id", user.id)
    .order("updated_at", { ascending: false });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
          <p className="text-sm text-ink-muted">
            Each campaign holds its own settings, imports and tickets.
          </p>
        </div>
        <Link href="/campaigns/new" className="btn-primary">
          New campaign
        </Link>
      </div>
      <div className="panel">
        <table className="w-full text-sm">
          <thead className="text-ink-muted text-xs uppercase">
            <tr className="border-b border-line">
              <th className="text-left font-medium px-4 py-2">Name</th>
              <th className="text-left font-medium px-4 py-2">Status</th>
              <th className="text-left font-medium px-4 py-2">Updated</th>
            </tr>
          </thead>
          <tbody>
            {!data || data.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-ink-muted">
                  No campaigns yet. <Link href="/campaigns/new" className="text-brand hover:underline">Create one</Link>.
                </td>
              </tr>
            ) : (
              data.map((c) => (
                <tr key={c.id} className="border-b border-line last:border-0 hover:bg-bg-subtle/50">
                  <td className="px-4 py-2">
                    <Link href={`/campaigns/${c.id}`} className="text-ink hover:text-brand">
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2 capitalize">{c.status}</td>
                  <td className="px-4 py-2 text-ink-muted">{formatDate(c.updated_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
