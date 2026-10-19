import http from "node:http";
import { getServiceSupabase } from "@mailpilot/server-core";

/**
 * Lightweight HTTP server for hosting-platform liveness probes.
 * Exposes /healthz and /readyz.
 *
 * Worker health is derived from the worker_heartbeat table — never fabricated.
 */
export function startHealthServer(port: number): { close: () => void } {
  const server = http.createServer(async (req, res) => {
    const url = req.url ?? "/";
    if (url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url === "/readyz") {
      try {
        const sb = getServiceSupabase();
        const { data, error } = await sb.from("worker_heartbeat").select("*").eq("id", "singleton").maybeSingle();
        if (error) throw error;
        const lastBeat = data?.last_beat_at ? new Date(data.last_beat_at).getTime() : 0;
        const ready = lastBeat > Date.now() - 60_000;
        res.writeHead(ready ? 200 : 503, { "content-type": "application/json" });
        res.end(JSON.stringify({ ready, last_beat: data?.last_beat_at ?? null }));
        return;
      } catch (e) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ ready: false, error: (e as Error).message }));
        return;
      }
    }
    res.writeHead(404);
    res.end("not found");
  });
  server.listen(port, () => {
    console.log(`[health] listening on :${port}`);
  });
  return { close: () => server.close() };
}
