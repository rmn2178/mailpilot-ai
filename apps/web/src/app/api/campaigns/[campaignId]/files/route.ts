import { NextResponse } from "next/server";
import {
  getServiceSupabase,
  assertCampaignOwnedBy,
  uploadPrivate,
  validateFileIntent,
  buildStorageKey,
  audit,
  enqueueIdempotent,
  QUEUE_NAMES,
  deletePrivate,
} from "@mailpilot/server-core";
import { requireAuth } from "@/lib/auth";
import { ok, fail, failInternal } from "@/lib/api/responses";

export const dynamic = "force-dynamic";

/**
 * Upload a campaign reference file (PDF, DOCX, TXT, MD, CSV, XLSX).
 *
 * Per §9: campaign reference documents are material the AI may use when
 * writing. They are NOT automatically outgoing attachments — that's a
 * separate concept managed per-ticket.
 *
 * After upload, enqueues a file-extraction job so the worker can extract
 * text content for the analyze prompt's `source_files` array.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ campaignId: string }> },
) {
  try {
    const { campaignId } = await ctx.params;
    const user = await requireAuth();
    await assertCampaignOwnedBy(campaignId, user.id);

    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return fail("VALIDATION_ERROR", "file required", 400);

    const bytes = new Uint8Array(await file.arrayBuffer());
    // Infer MIME from extension when the browser sends a generic type.
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

    const storagePath = buildStorageKey(`campaigns/${campaignId}`, file.name);
    const up = await uploadPrivate(storagePath, bytes, mime);

    const sb = getServiceSupabase();
    const { data: fileRow, error } = await sb.from("campaign_files").insert({
      campaign_id: campaignId,
      filename: file.name,
      storage_path: storagePath,
      mime,
      size_bytes: up.size,
      sha256: up.sha256,
      purpose: "campaign_reference",
      extraction_status: "pending",
    }).select("id").single();
    if (error) throw new Error(error.message);

    // Enqueue extraction — the worker extracts text content for the analyze
    // prompt's source_files array.
    await enqueueIdempotent(
      QUEUE_NAMES.fileExtraction,
      "extract",
      { fileId: fileRow.id },
      `extract-${fileRow.id}`,
    );

    await audit({
      actor_id: user.id,
      action: "campaign_file.upload",
      resource_type: "campaign_file",
      resource_id: fileRow.id,
      campaign_id: campaignId,
      ticket_id: null,
      metadata: { filename: file.name, size: up.size, mime },
    });

    return ok({ id: fileRow.id, sha256: up.sha256 });
  } catch (e) {
    return failInternal((e as Error).message);
  }
}

/**
 * List campaign reference files.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ campaignId: string }> },
) {
  try {
    const { campaignId } = await ctx.params;
    const user = await requireAuth();
    await assertCampaignOwnedBy(campaignId, user.id);
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from("campaign_files")
      .select("id, filename, mime, size_bytes, purpose, extraction_status, extraction_failure, created_at")
      .eq("campaign_id", campaignId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return ok({ files: data ?? [] });
  } catch (e) {
    return failInternal((e as Error).message);
  }
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ campaignId: string }> },
) {
  try {
    const { campaignId } = await ctx.params;
    const user = await requireAuth();
    await assertCampaignOwnedBy(campaignId, user.id);
    const url = new URL(req.url);
    const fileId = url.searchParams.get("id");
    if (!fileId) return fail("VALIDATION_ERROR", "id required", 400);

    const sb = getServiceSupabase();
    const { data: fileRow } = await sb
      .from("campaign_files")
      .select("storage_path, filename")
      .eq("id", fileId)
      .eq("campaign_id", campaignId)
      .maybeSingle();
    if (!fileRow) return fail("NOT_FOUND", "File not found", 404);

    // Detach any ticket_attachments referencing this file (don't delete them —
    // they may be in use as outgoing attachments on already-sent emails).
    await sb.from("ticket_attachments")
      .update({ campaign_file_id: null })
      .eq("campaign_file_id", fileId);

    await sb.from("campaign_files").delete().eq("id", fileId).eq("campaign_id", campaignId);

    // Best-effort storage delete.
    await deletePrivate(fileRow.storage_path).catch(() => {});

    await audit({
      actor_id: user.id,
      action: "campaign_file.delete",
      resource_type: "campaign_file",
      resource_id: fileId,
      campaign_id: campaignId,
      ticket_id: null,
      metadata: { filename: fileRow.filename },
    });

    return ok({ deleted: true });
  } catch (e) {
    return failInternal((e as Error).message);
  }
}
