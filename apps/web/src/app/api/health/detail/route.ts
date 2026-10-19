import { NextResponse } from "next/server";
import { getServiceSupabase } from "@mailpilot/server-core";
import { requireAuth } from "@/lib/auth";
import { ok, failInternal } from "@/lib/api/responses";

export const dynamic = "force-dynamic";

/**
 * Detailed health endpoint — authenticated. Returns worker heartbeat + queue
 * depth + provider availability.
 *
 * Per §12 (5th-pass): the public `/api/health` (no `/detail`) returns only
 * `{ ok: true }` as a liveness probe. Worker telemetry is authenticated so
 * an unauthenticated internet caller cannot poll heartbeat timestamps or
 * queue depth.
 */
export async function GET() {
  try {
    await requireAuth();
    const sb = getServiceSupabase();
    const { data: worker } = await sb
      .from("worker_heartbeat")
      .select("last_beat_at, queue_depth, active_jobs, failed_jobs")
      .eq("id", "singleton")
      .maybeSingle();
    const lastBeatMs = worker?.last_beat_at ? new Date(worker.last_beat_at).getTime() : 0;
    const online = lastBeatMs > Date.now() - 60_000;
    return ok({
      worker: {
        online,
        last_heartbeat_at: worker?.last_beat_at ?? null,
        queue_depth: worker?.queue_depth ?? 0,
        active_jobs: worker?.active_jobs ?? 0,
        failed_jobs: worker?.failed_jobs ?? 0,
      },
    });
  } catch (e) {
    return failInternal((e as Error).message);
  }
}
