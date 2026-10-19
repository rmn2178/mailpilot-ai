import { NextResponse } from "next/server";
import { ok } from "@/lib/api/responses";

export const dynamic = "force-dynamic";

/**
 * Public liveness probe. Returns only `{ ok: true }` — no worker state, no
 * queue depth, no provider info. Per §12 (5th-pass): the previous version
 * leaked worker heartbeat timestamps and queue depth to any caller.
 *
 * Authenticated callers (the app shell, dashboard widgets) should hit
 * `/api/health/detail` instead, which requires a session and returns the
 * full telemetry payload.
 */
export async function GET() {
  return ok({ ok: true });
}

// `NextResponse` is imported for type-discovery only — `ok()` already
// constructs and returns a NextResponse. The import is here so a future
// refactor that needs `NextResponse.json` directly does not need to add
// the import.
void NextResponse;
