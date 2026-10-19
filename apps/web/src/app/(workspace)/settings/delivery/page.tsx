import { requireAuth } from "@/lib/auth";
import { getServiceSupabase } from "@mailpilot/server-core";
import { DeliveryActions } from "@/components/settings/delivery-actions";

export const dynamic = "force-dynamic";

export default async function DeliverySettingsPage() {
  const user = await requireAuth();
  const sb = getServiceSupabase();
  const { data: global } = await sb
    .from("global_settings")
    .select("key, value")
    .eq("key", "global_send_switch")
    .maybeSingle();
  // Per bug A: Supabase returns jsonb as a parsed JS value, so the value is
  // the string "stopped" (no quotes) or "enabled". Handle both forms for safety.
  const raw = global?.value;
  const isStopped = raw === "stopped" || raw === '"stopped"' || raw === true;

  const { data: suppressed } = await sb
    .from("suppression_list")
    .select("email, reason, created_at")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div className="p-6 max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Delivery</h1>
      <div className="panel panel-pad space-y-3">
        <h2 className="font-semibold">Global send switch</h2>
        <p className="text-sm text-ink-muted">
          Stops ALL outgoing sends across every campaign. Use for incidents.
        </p>
        <DeliveryActions initialStopped={isStopped} />
      </div>
      <div className="panel">
        <div className="px-4 py-3 border-b border-line font-semibold text-sm">
          Suppression list
        </div>
        {!suppressed || suppressed.length === 0 ? (
          <div className="px-4 py-6 text-center text-ink-muted text-sm">Empty.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-ink-muted text-xs uppercase">
              <tr className="border-b border-line">
                <th className="text-left font-medium px-4 py-2">Email</th>
                <th className="text-left font-medium px-4 py-2">Reason</th>
              </tr>
            </thead>
            <tbody>
              {suppressed.map((s) => (
                <tr key={s.email} className="border-b border-line last:border-0">
                  <td className="px-4 py-2">{s.email}</td>
                  <td className="px-4 py-2 text-ink-muted">{s.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
