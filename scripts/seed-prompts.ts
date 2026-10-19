/**
 * Seeds the prompt_versions table with the built-in default prompts as
 * version 1 of each role, enabled. Safe to re-run (uses onConflict do nothing).
 *
 * Usage: pnpm seed-prompts
 *
 * Requires DATABASE_URL / Supabase env to be set.
 */
import { loadEnv, getServiceSupabase, BUILTIN_PROMPTS } from "../packages/server-core/src/index.js";

async function main() {
  loadEnv();
  const sb = getServiceSupabase();
  for (const [role, prompt] of Object.entries(BUILTIN_PROMPTS)) {
    // Per bug C: use order+limit(1) instead of maybeSingle() — after a UI
    // prompt edit, there are multiple rows per role (v1 disabled, v2 enabled),
    // and maybeSingle() errors on >1 row.
    const { data: existing } = await sb
      .from("prompt_versions")
      .select("id, version")
      .eq("role", role)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) {
      console.log(`  ${role}: already seeded (v${existing.version}, skipping)`);
      continue;
    }
    await sb.from("prompt_versions").insert({
      role,
      version: 1,
      system_prompt: prompt,
      enabled: true,
      notes: "Built-in default (seeded)",
    });
    console.log(`  ${role}: seeded v1`);
  }
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
