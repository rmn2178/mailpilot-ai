import type { Job } from "bullmq";
import {
  getServiceSupabase,
  fetchPrivateBytes,
  extractByMime,
  recordWorkflowEvent,
} from "@mailpilot/server-core";

/**
 * File extraction processor — runs safe text extraction on a campaign_file
 * and stores the result. Never fabricates text — failures are recorded
 * explicitly and visible in the UI.
 */
export async function processExtractFile(
  job: Job<{ fileId: string }>,
): Promise<void> {
  const { fileId } = job.data;
  const sb = getServiceSupabase();
  const { data: file } = await sb.from("campaign_files").select("*").eq("id", fileId).maybeSingle();
  if (!file) throw new Error(`File ${fileId} not found`);

  // Per line-by-line audit: idempotency guard. If extraction is already
  // completed, skip — the text is already stored.
  if (file.extraction_status === "completed") return;

  await sb.from("campaign_files").update({ extraction_status: "extracting" }).eq("id", fileId);

  const bytes = await fetchPrivateBytes(file.storage_path);
  const result = await extractByMime(bytes, file.mime, file.filename);

  await sb.from("campaign_files").update({
    extraction_status: result.failure ? "failed" : "completed",
    extraction_text: result.text || null,
    extraction_failure: result.failure,
    extracted_at: new Date().toISOString(),
  }).eq("id", fileId);

  await recordWorkflowEvent({
    ticket_id: null,
    campaign_id: file.campaign_id,
    stage: "file_extraction",
    event_type: result.failure ? "extraction_failed" : "extraction_completed",
    metadata: { filename: file.filename, warnings: result.warnings },
    error: result.failure,
  });
}
