import { NextRequest } from "next/server";
import {
  getServiceSupabase,
  assertCampaignOwnedBy,
  uploadPrivate,
  validateFileIntent,
  buildStorageKey,
  audit,
} from "@mailpilot/server-core";
import { requireAuth } from "@/lib/auth";
import { ok, fail, failInternal } from "@/lib/api/responses";
import { triggerPipeline } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const campaignId = form.get("campaign_id") as string | null;
    if (!file || !campaignId) return fail("VALIDATION_ERROR", "file and campaign_id required", 400);
    await assertCampaignOwnedBy(campaignId, user.id);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const filename = file.name.toLowerCase();
    let mime = file.type || "application/octet-stream";
    if (mime === "application/octet-stream" || mime === "application/x-download") {
      if (filename.endsWith(".csv")) mime = "text/csv";
      else if (filename.endsWith(".xlsx")) mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      else if (filename.endsWith(".xls")) mime = "application/vnd.ms-excel";
      else if (filename.endsWith(".pdf")) mime = "application/pdf";
      else if (filename.endsWith(".docx")) mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      else if (filename.endsWith(".txt")) mime = "text/plain";
      else if (filename.endsWith(".md")) mime = "text/markdown";
    }
    validateFileIntent(file.name, mime, bytes.byteLength);

    const storagePath = buildStorageKey(`imports/${campaignId}`, file.name);
    await uploadPrivate(storagePath, bytes, mime);

    const sb = getServiceSupabase();
    const { data: importRow, error } = await sb.from("imports").insert({
      campaign_id: campaignId,
      filename: file.name,
      storage_path: storagePath,
      mime,
      status: "uploaded",
    }).select("id").single();
    if (error) throw new Error(error.message);

    await audit({ actor_id: user.id, action: "import.upload", resource_type: "import", resource_id: importRow.id, campaign_id: campaignId, ticket_id: null, metadata: { filename: file.name, size: bytes.byteLength } });

    // Trigger the import pipeline step (non-blocking).
    triggerPipeline({ job: "import", importId: importRow.id }, req.url);

    return ok({ id: importRow.id });
  } catch (e) {
    return failInternal((e as Error).message);
  }
}
