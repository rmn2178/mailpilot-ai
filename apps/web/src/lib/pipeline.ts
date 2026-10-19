import type { PipelineJob } from "@mailpilot/server-core";

/**
 * Trigger a pipeline job as a non-blocking background call.
 * Safe to call from any API route — returns immediately.
 */
export function triggerPipeline(job: PipelineJob, requestUrl: string): void {
  const url = new URL(requestUrl);
  const baseUrl = `${url.protocol}//${url.host}`;
  const endpoint = `${baseUrl}/api/worker/process`;
  const secret = process.env.TOKEN_ENCRYPTION_KEY ?? "";

  void fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", "x-pipeline-secret": secret },
    body: JSON.stringify(job),
  }).catch((e) => console.error("[pipeline] trigger failed:", e.message));
}
