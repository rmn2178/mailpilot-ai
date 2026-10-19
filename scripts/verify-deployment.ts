/**
 * Post-deployment verification. Checks:
 *   1. Database is reachable
 *   2. Required tables exist
 *   3. Worker heartbeat is fresh
 *   4. AI slots are configured
 *   5. Global send switch state
 *
 * Usage: pnpm verify-deployment
 */
import { loadEnv, getServiceSupabase } from "../packages/server-core/src/index.js";

async function main() {
  loadEnv();
  const sb = getServiceSupabase();

  console.log("Checking database connectivity…");
  const { error: profilesErr } = await sb.from("profiles").select("*").limit(1);
  if (profilesErr) {
    console.error("✗ DB unreachable:", profilesErr.message);
    process.exit(1);
  }
  console.log("✓ DB reachable");

  console.log("Checking required tables…");
  // Per bug #9: use select("*") instead of select("id") — some tables
  // (campaign_settings, provider_settings, worker_heartbeat, global_settings)
  // don't have an "id" column.
  for (const t of [
    "campaigns", "campaign_settings", "imports", "import_rows", "contacts",
    "tickets", "email_versions", "ai_reviews", "workflow_events",
    "approval_events", "audit_log", "campaign_files", "ticket_attachments",
    "sender_accounts", "send_operations", "provider_settings",
    "prompt_versions", "suppression_list", "usage_records",
    "worker_heartbeat", "global_settings", "campaign_pause_events",
    "send_reconciliation",
  ]) {
    const { error, count } = await sb.from(t).select("*", { count: "exact", head: true });
    if (error) console.error(`✗ Table ${t}: ${error.message}`);
    else console.log(`  ✓ ${t} (${count ?? 0} rows)`);
  }

  console.log("Checking worker heartbeat…");
  const { data: hb } = await sb.from("worker_heartbeat").select("*").eq("id", "singleton").maybeSingle();
  if (!hb?.last_beat_at) {
    console.warn("⚠ Worker has never heartbeated — is the worker process running?");
  } else {
    const age = Date.now() - new Date(hb.last_beat_at).getTime();
    if (age > 60_000) console.warn(`⚠ Worker heartbeat is stale (${Math.round(age / 1000)}s old)`);
    else console.log(`✓ Worker heartbeated ${Math.round(age / 1000)}s ago`);
  }

  console.log("Checking AI slots…");
  const { data: slots } = await sb.from("provider_settings").select("slot, enabled, model_id").order("slot");
  for (const s of slots ?? []) {
    console.log(`  ${s.slot}: ${s.enabled ? "enabled" : "disabled"} (${s.model_id})`);
  }

  console.log("Checking global send switch…");
  const { data: gs } = await sb.from("global_settings").select("value").eq("key", "global_send_switch").maybeSingle();
  console.log(`  global_send_switch = ${gs?.value ?? "(unset)"}`);

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
