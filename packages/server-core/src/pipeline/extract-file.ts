import { getServiceSupabase } from "../db";
import { fetchPrivateBytes } from "../storage";
import { extractByMime } from "../documents/index";
import { recordWorkflowEvent } from "../workflow/index";

export async function runExtractFile(fileId: string): Promise<void> {
  const sb = getServiceSupabase();
  const { data: file } = await sb.from("campaign_files").select("*").eq("id", fileId).maybeSingle();
  if (!file) throw new Error(`File ${fileId} not found`);
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
