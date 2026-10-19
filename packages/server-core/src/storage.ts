import { getServiceSupabase } from "./db";
import { requireServerEnv } from "./env";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Private Supabase Storage wrapper for reference files, supporting files,
 * and email attachments. Files are never served via public URLs — only via
 * short-lived signed URLs authenticated by the server.
 */

const ALLOWED_EXTENSIONS = new Set([
  ".pdf",
  ".docx",
  ".txt",
  ".md",
  ".xlsx",
  ".xls",
  ".csv",
]);

const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/csv",
  // Browsers frequently send generic octet-stream for .xlsx and .docx —
  // accept it but rely on extension validation for the security decision.
  "application/octet-stream",
  "application/x-download",
]);

// Gmail's hard limit is 25 MB for the *encoded* message (attachments + body
// after base64 expansion). A 25 MiB attachment base64-encodes to ~33 MiB,
// which exceeds the limit. We cap at 18 MiB to leave headroom for the body
// and base64 expansion (33% overhead). Sends above this size would fail
// with Gmail 413 Payload Too Large.
export const MAX_FILE_SIZE_BYTES = 18 * 1024 * 1024; // 18 MiB

export interface UploadedFile {
  path: string;
  size: number;
  mime: string;
  bucket: string;
  sha256: string;
}

export function validateFileIntent(filename: string, mime: string, size: number): void {
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(`File extension not allowed: ${ext || "(none)"}`);
  }
  if (!ALLOWED_MIME.has(mime)) {
    throw new Error(`MIME type not allowed: ${mime}`);
  }
  if (size > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `File too large: ${size} bytes (max ${MAX_FILE_SIZE_BYTES})`,
    );
  }
  // Reject formula-like spreadsheet cells is enforced at the parser level
  // (see imports/parser.ts). Here we only validate metadata.
}

export async function uploadPrivate(
  key: string,
  bytes: Uint8Array,
  mime: string,
): Promise<UploadedFile> {
  const env = requireServerEnv();
  const sb = getServiceSupabase();
  const bucket = env.SUPABASE_STORAGE_BUCKET;
  const { error } = await sb.storage
    .from(bucket)
    .upload(key, bytes, {
      contentType: mime,
      upsert: false,
      cacheControl: "no-cache",
    });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  return { path: key, size: bytes.byteLength, mime, bucket, sha256 };
}

export async function createSignedReadUrl(
  storagePath: string,
  expiresInSec = 60,
): Promise<string> {
  const env = requireServerEnv();
  const sb = getServiceSupabase();
  const bucket = env.SUPABASE_STORAGE_BUCKET;
  const { data, error } = await sb.storage
    .from(bucket)
    .createSignedUrl(storagePath, expiresInSec);
  if (error || !data?.signedUrl) {
    throw new Error(`Could not sign storage URL: ${error?.message ?? "unknown"}`);
  }
  return data.signedUrl;
}

export async function deletePrivate(storagePath: string): Promise<void> {
  const env = requireServerEnv();
  const sb = getServiceSupabase();
  const { error } = await sb.storage
    .from(env.SUPABASE_STORAGE_BUCKET)
    .remove([storagePath]);
  if (error) throw new Error(`Storage delete failed: ${error.message}`);
}

export async function fetchPrivateBytes(storagePath: string): Promise<Uint8Array> {
  const env = requireServerEnv();
  const sb = getServiceSupabase();
  const { data, error } = await sb.storage
    .from(env.SUPABASE_STORAGE_BUCKET)
    .download(storagePath);
  if (error || !data) throw new Error(`Storage download failed: ${error?.message}`);
  return new Uint8Array(await data.arrayBuffer());
}

export function buildStorageKey(prefix: string, filename: string): string {
  const safeBase = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  const rand = crypto.randomBytes(6).toString("hex");
  const ts = Date.now();
  return `${prefix}/${ts}-${rand}-${safeBase}`;
}
