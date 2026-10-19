import { requireAuth } from "@/lib/auth";
import { getServiceSupabase } from "@mailpilot/server-core";
import { GmailConnectCard } from "@/components/settings/gmail-connect-card";

export const dynamic = "force-dynamic";

export default async function ConnectionsPage() {
  const user = await requireAuth();
  const sb = getServiceSupabase();
  const { data: account } = await sb
    .from("sender_accounts")
    .select("email, scope, connected_at")
    .eq("owner_id", user.id)
    .order("connected_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <div className="p-6 max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Gmail connection</h1>
        <p className="text-sm text-ink-muted">
          Used as the authenticated sender for all draft and direct-send operations.
        </p>
      </div>
      <GmailConnectCard
        account={account ? { email: account.email, connected_at: account.connected_at } : null}
      />
    </div>
  );
}
