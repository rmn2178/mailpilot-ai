import type { Job } from "bullmq";
import {
  getServiceSupabase,
  fetchPrivateBytes,
  parseSpreadsheet,
  validateRows,
  stableHash,
  recordWorkflowEvent,
} from "@mailpilot/server-core";

/**
 * Import processor.
 *
 * Parses an uploaded spreadsheet, validates every row, persists import_rows
 * with status & reasons, and updates the import record. NEVER silently
 * discards a row — empty rows are recorded as `empty`, duplicates as
 * `duplicate`, invalid as `invalid` with reasons.
 */
export async function processImport(job: Job<{ importId: string }>): Promise<void> {
  const { importId } = job.data;
  const sb = getServiceSupabase();

  const { data: imp } = await sb.from("imports").select("*").eq("id", importId).maybeSingle();
  if (!imp) throw new Error(`Import ${importId} not found`);

  // Per line-by-line audit: idempotency guard. If parsing is already done
  // (import_preview or import_completed), skip — the rows are already stored.
  if (imp.status === "import_preview" || imp.status === "import_completed") {
    return;
  }

  await sb.from("imports").update({ status: "import_validating" }).eq("id", importId);

  await recordWorkflowEvent({
    ticket_id: null,
    campaign_id: imp.campaign_id,
    stage: "import",
    event_type: "parse_started",
    metadata: { filename: imp.filename },
  });

  const bytes = await fetchPrivateBytes(imp.storage_path);
  const parsed = await parseSpreadsheet(bytes, imp.mime, imp.filename);
  const sheet = parsed.sheets[0];
  if (!sheet) throw new Error("Spreadsheet has no sheets");

  const emailHeader = sheet.headers.find((h) => /e-?mail/i.test(h)) ?? sheet.headers[0];
  const firstHeader = sheet.headers.find((h) => /first[\s_-]?name/i.test(h));
  const lastHeader = sheet.headers.find((h) => /last[\s_-]?name/i.test(h));
  const companyHeader = sheet.headers.find((h) => /company/i.test(h));
  const titleHeader = sheet.headers.find((h) => /(title|role|position)/i.test(h));

  const results = validateRows(sheet.rows, {
    email: emailHeader ?? sheet.headers[0] ?? "",
    first_name: firstHeader,
    last_name: lastHeader,
    company: companyHeader,
    job_title: titleHeader,
  });

  const valid = results.filter((r) => r.status === "valid");
  const invalid = results.filter((r) => r.status === "invalid");
  const empty = results.filter((r) => r.status === "empty");
  const duplicates = results.filter((r) => r.status === "duplicate");

  await sb.from("import_rows").delete().eq("import_id", importId);
  if (results.length > 0) {
    await sb.from("import_rows").insert(
      results.map((r) => ({
        import_id: importId,
        row_number: r.row_number,
        raw: r.mapped,
        mapped: r.mapped,
        status: r.status,
        reasons: r.reasons,
        stable_hash: stableHash({
          campaign_id: imp.campaign_id,
          email: r.mapped.email ?? "",
          first_name: r.mapped.first_name ?? null,
          last_name: r.mapped.last_name ?? null,
          company: r.mapped.company ?? null,
          job_title: r.mapped.job_title ?? null,
        }),
      })),
    );
  }

  await sb.from("imports").update({
    status: "import_preview",
    total_rows: results.length,
    valid_rows: valid.length,
    invalid_rows: invalid.length,
    duplicate_rows: duplicates.length,
    report: { empty: empty.length, headers: sheet.headers },
    updated_at: new Date().toISOString(),
  }).eq("id", importId);

  await recordWorkflowEvent({
    ticket_id: null,
    campaign_id: imp.campaign_id,
    stage: "import",
    event_type: "parse_completed",
    metadata: {
      total: results.length,
      valid: valid.length,
      invalid: invalid.length,
      duplicates: duplicates.length,
      empty: empty.length,
    },
  });
}
