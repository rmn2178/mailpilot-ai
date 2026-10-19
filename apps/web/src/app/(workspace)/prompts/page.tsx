import { requireAuth } from "@/lib/auth";
import { getServiceSupabase } from "@mailpilot/server-core";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PromptsPage() {
  await requireAuth();
  const sb = getServiceSupabase();
  const { data } = await sb
    .from("prompt_versions")
    .select("id, role, version, enabled, notes, created_at")
    .order("created_at", { ascending: false });
  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Prompts</h1>
        <p className="text-sm text-ink-muted">
          Versioned system prompts per AI role. Built-in defaults are used
          when no enabled override exists.
        </p>
      </div>
      <div className="panel">
        <table className="w-full text-sm">
          <thead className="text-ink-muted text-xs uppercase">
            <tr className="border-b border-line">
              <th className="text-left font-medium px-4 py-2">Role</th>
              <th className="text-left font-medium px-4 py-2">Version</th>
              <th className="text-left font-medium px-4 py-2">Enabled</th>
              <th className="text-left font-medium px-4 py-2">Notes</th>
              <th className="text-left font-medium px-4 py-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {!data || data.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-ink-muted">No prompt overrides — built-in defaults are active.</td></tr>
            ) : (
              data.map((p) => (
                <tr key={p.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2 font-mono">{p.role}</td>
                  <td className="px-4 py-2">v{p.version}</td>
                  <td className="px-4 py-2">{p.enabled ? "yes" : "no"}</td>
                  <td className="px-4 py-2 text-ink-muted">{p.notes ?? "—"}</td>
                  <td className="px-4 py-2 text-ink-muted">{formatDate(p.created_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
