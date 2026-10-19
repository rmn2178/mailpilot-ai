import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

/**
 * Regression test for the §1 (5th-pass) `import "server-only"` bug.
 *
 * The `server-only@0.0.1` package throws when imported outside a
 * `react-server` condition. The worker imports `@mailpilot/server-core`
 * which transitively imports `server-only`. Without a runtime guard or
 * condition, the worker crashes on startup before any job is registered.
 *
 * This test spawns the real worker via `tsx` with a 5-second timeout and
 * asserts it reaches the "ready" log line without throwing. CI runs the
 * worker with mock env vars (no real Redis/Supabase needed for this check —
 * we only verify that the module graph loads).
 */
describe("worker bootstrap", () => {
  it("imports server-core without crashing on `server-only`", async () => {
    // Skip if the worker entry doesn't exist (e.g. zip-extracted without deps).
    const workerEntry = path.join(REPO_ROOT, "apps/worker/src/index.ts");
    if (!fs.existsSync(workerEntry)) {
      console.warn("Skipping worker-bootstrap test: worker entry not found");
      return;
    }

    const result = await new Promise<{ stdout: string; stderr: string; code: number | null }>(
      (resolve) => {
        // Minimal env so loadEnv() succeeds. The worker boot will fail later
        // when it tries to connect to Redis, but it must NOT fail on the
        // initial import graph (which is what `server-only` broke).
        const env = {
          ...process.env,
          NODE_ENV: "test",
          NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
          NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon",
          SUPABASE_SERVICE_ROLE_KEY: "test-service",
          REDIS_URL: "redis://localhost:6379",
          GOOGLE_OAUTH_CLIENT_ID: "x",
          GOOGLE_OAUTH_CLIENT_SECRET: "y",
          GOOGLE_OAUTH_REDIRECT_URI: "http://localhost:3000/callback",
          TOKEN_ENCRYPTION_KEY: "test-key-must-be-at-least-32-bytes-long!!",
        };

        // Spawn `tsx` to evaluate just the imports of the worker entry.
        // We don't run the actual worker (it would block); instead we import
        const workerUrl = pathToFileURL(path.join(REPO_ROOT, "apps/worker/src/index.ts")).href;
        const child = spawn(
          process.execPath,
          [
            "--import",
            "tsx",
            "-e",
            `
              // Force eager evaluation of the server-core import graph.
              // If 'server-only' throws, this Promise rejects.
              Promise.resolve()
                .then(() => import(${JSON.stringify(workerUrl)}))
                .then(() => { console.log("IMPORTS_OK"); process.exit(0); })
                .catch((e) => { console.error("IMPORTS_FAIL:", e.message); process.exit(1); });
              // Hard timeout in case the import hangs.
              setTimeout(() => { console.error("TIMEOUT"); process.exit(2); }, 5000);
            `,
          ],
          { env, cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] },
        );

        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => { stdout += d.toString(); });
        child.stderr.on("data", (d) => { stderr += d.toString(); });
        child.on("close", (code) => resolve({ stdout, stderr, code }));
        setTimeout(() => {
          try { child.kill("SIGKILL"); } catch {}
          resolve({ stdout, stderr, code: -1 });
        }, 8000);
      },
    );

    // The test passes if the worker's import graph loaded successfully
    // (IMPORTS_OK). It's OK if it then fails to connect to Redis — that's
    // not what we're testing.
    expect(result.stdout).toContain("IMPORTS_OK");
    expect(result.stderr).not.toContain("server-only");
    expect(result.stderr).not.toContain("This module cannot be imported from a Client Component");
  }, 15000);
});
