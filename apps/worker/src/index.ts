import { loadEnv } from "@mailpilot/server-core";

/**
 * Worker process entrypoint.
 *
 * Per spec §3: the worker is a separately-runnable Node.js process. It does
 * NOT depend on an open browser tab. Closing the dashboard must not stop
 * processing.
 */

async function main() {
  const env = loadEnv();
  console.log(`[mailpilot-worker] booting in ${env.NODE_ENV} mode`);

  const { startHealthServer } = await import("./health-server");
  const { bootstrap } = await import("./queues/registry");
  const { runRecoverySweep } = await import("./services/recovery-service");

  const health = startHealthServer(7070);
  const workers = await bootstrap();
  console.log(`[mailpilot-worker] ${workers.length} workers started`);

  await runRecoverySweep();

  const shutdown = async (signal: string) => {
    console.log(`[mailpilot-worker] received ${signal}, shutting down`);
    health.close();
    await Promise.allSettled(workers.map((w) => w.close()));
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  console.log("[mailpilot-worker] ready");
}

main().catch((e) => {
  console.error("[mailpilot-worker] fatal:", e);
  process.exit(1);
});
