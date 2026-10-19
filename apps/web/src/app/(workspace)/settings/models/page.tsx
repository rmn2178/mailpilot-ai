import { requireAuth } from "@/lib/auth";
import { getServiceSupabase } from "@mailpilot/server-core";
import { ModelSlotsTable } from "@/components/settings/model-slots-table";

export const dynamic = "force-dynamic";

export default async function ModelSettingsPage() {
  await requireAuth();
  const sb = getServiceSupabase();
  const { data } = await sb
    .from("provider_settings")
    .select("*")
    .order("slot");
  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Models & credentials</h1>
        <p className="text-sm text-ink-muted">
          Eight logical AI slots. Credential slots are NOT independent capacity —
          a shared project quota is enforced upstream.
        </p>
      </div>
      <ModelSlotsTable slots={data ?? []} />
    </div>
  );
}
