/**
 * Checks that all required environment variables are present and well-formed.
 * Run before `pnpm dev`, `pnpm build`, or `pnpm start:worker`.
 *
 * Usage: pnpm check-env
 */
import { loadEnv } from "../packages/server-core/src/env.js";

try {
  const env = loadEnv();
  console.log("✓ Environment OK");
  console.log(`  App URL: ${env.NEXT_PUBLIC_APP_URL}`);
  console.log(`  Supabase URL: ${env.NEXT_PUBLIC_SUPABASE_URL}`);
  console.log(`  Redis URL: ${env.REDIS_URL}`);
  console.log(`  Worker concurrency: ${env.WORKER_CONCURRENCY}`);
  console.log(`  Max revision cycles: ${env.MAX_REVISION_CYCLES}`);
  console.log(`  Gemini slots configured: ${[env.GEMINI_API_KEY_1, env.GEMINI_API_KEY_2, env.GEMINI_API_KEY_3, env.GEMINI_API_KEY_4].filter(Boolean).length}/4`);
  console.log(`  Grok slots configured: ${[env.XAI_API_KEY_1, env.XAI_API_KEY_2, env.XAI_API_KEY_3, env.XAI_API_KEY_4].filter(Boolean).length}/4`);
} catch (e) {
  console.error("✗ Environment check failed:");
  console.error((e as Error).message);
  process.exit(1);
}
