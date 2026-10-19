import { getServiceSupabase } from "@mailpilot/server-core";

/**
 * Returns true if the global send switch is in the "stopped" state.
 * Per bug A: handles all possible stored forms — boolean true, string "stopped",
 * or the legacy quoted-string form.
 */
export async function isGlobalSendStopped(): Promise<boolean> {
  const sb = getServiceSupabase();
  const { data } = await sb
    .from("global_settings")
    .select("value")
    .eq("key", "global_send_switch")
    .maybeSingle();
  const raw = data?.value;
  return raw === true || raw === "stopped" || raw === '"stopped"';
}
