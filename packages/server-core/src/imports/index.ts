import ExcelJS from "exceljs";
import Papa from "papaparse";
import crypto from "node:crypto";

export interface ParsedSheet {
  name: string;
  headers: string[];
  rows: Record<string, unknown>[];
}

export interface ParsedWorkbook {
  sheets: ParsedSheet[];
  activeSheetName: string;
}

/**
 * Spreadsheet parser.
 *
 * Supports .xlsx and .csv. CSV is parsed as a single sheet named "Sheet1".
 *
 * SECURITY: All cell values are coerced to strings and never interpreted
 * as formulas. ExcelJS does not evaluate formulas on read; we explicitly
 * skip formula results that look like commands ("=cmd|...").
 *
 * Per spec §6: never silently discard a row. Preserve row numbers and
 * validation reasons at the import_rows level.
 */
export async function parseSpreadsheet(
  bytes: Uint8Array,
  mime: string,
  filename: string,
): Promise<ParsedWorkbook> {
  const isCsv =
    mime.includes("csv") || filename.toLowerCase().endsWith(".csv");
  if (isCsv) {
    const text = Buffer.from(bytes).toString("utf8");
    const result = Papa.parse<Record<string, unknown>>(text, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      transformHeader: (h) => h.trim(),
    });
    const headers = (result.meta.fields ?? []).filter((h) => h.length > 0);
    return {
      sheets: [
        {
          name: "Sheet1",
          headers,
          rows: result.data.map((r) =>
            Object.fromEntries(
              headers.map((h) => [h, sanitizeCell((r as Record<string, unknown>)[h])]),
            ),
          ),
        },
      ],
      activeSheetName: "Sheet1",
    };
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  const sheets: ParsedSheet[] = [];
  for (const ws of wb.worksheets) {
    const headerRow = ws.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
      headers[col - 1] = String(cell.value ?? "").trim();
    });
    const cleanHeaders = headers.filter((h) => h && h.length > 0);
    const rows: Record<string, unknown>[] = [];
    ws.eachRow((row, rowNum) => {
      if (rowNum === 1) return;
      const obj: Record<string, unknown> = {};
      // Per bug #3: iterate the ORIGINAL headers array (with gaps) and use
      // the original column index for getCell. The previous version filtered
      // headers first, then used the filtered index — causing an off-by-one
      // shift after any empty header cell.
      headers.forEach((h, idx) => {
        if (h && h.length > 0) {
          const cell = row.getCell(idx + 1);
          obj[h] = sanitizeCell(cell.value);
        }
      });
      rows.push(obj);
    });
    sheets.push({ name: ws.name, headers: cleanHeaders, rows });
  }
  const activeSheetName = sheets[0]?.name ?? "";
  return { sheets, activeSheetName };
}

function sanitizeCell(v: unknown): unknown {
  if (v == null) return "";
  if (typeof v === "object") {
    // ExcelJS formula result object: { formula: '...', result: ... }
    const obj = v as { formula?: unknown; result?: unknown; hyperlink?: string };
    if (typeof obj.formula === "string") {
      // SECURITY: never execute. If it looks like a command-injection attempt,
      // blank it. Otherwise return the cached result if any.
      if (/=cmd|wscript|powershell/i.test(obj.formula)) return "";
      return obj.result == null ? "" : String(obj.result);
    }
    if (obj.hyperlink) return String(obj.result ?? obj.hyperlink);
    return "";
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return String(v).trim();
}

// ─── Validation ─────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ValidationResult {
  row_number: number;
  status: "valid" | "invalid" | "duplicate" | "empty";
  reasons: string[];
  mapped: {
    email: string | null;
    first_name: string | null;
    last_name: string | null;
    company: string | null;
    job_title: string | null;
  };
}

export interface ColumnMapping {
  email: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  job_title?: string;
}

export function validateRows(
  rows: Record<string, unknown>[],
  mapping: ColumnMapping,
): ValidationResult[] {
  const seenEmails = new Set<string>();
  return rows.map((raw, idx) => {
    const row_number = idx + 2; // header + 1-indexed
    const email = String(raw[mapping.email] ?? "").trim();
    const first_name = mapping.first_name ? String(raw[mapping.first_name] ?? "").trim() : "";
    const last_name = mapping.last_name ? String(raw[mapping.last_name] ?? "").trim() : "";
    const company = mapping.company ? String(raw[mapping.company] ?? "").trim() : "";
    const job_title = mapping.job_title ? String(raw[mapping.job_title] ?? "").trim() : "";

    const mapped = {
      email: email || null,
      first_name: first_name || null,
      last_name: last_name || null,
      company: company || null,
      job_title: job_title || null,
    };

    const reasons: string[] = [];
    if (!email && !first_name && !last_name && !company && !job_title) {
      return { row_number, status: "empty", reasons: ["all mapped fields empty"], mapped };
    }
    if (!email) reasons.push("missing email");
    else if (!EMAIL_RE.test(email)) reasons.push(`invalid email format: ${email}`);
    if (email && seenEmails.has(email.toLowerCase())) {
      reasons.push("duplicate email within this import");
      return { row_number, status: "duplicate", reasons, mapped };
    }
    if (email) seenEmails.add(email.toLowerCase());
    if (reasons.length > 0) return { row_number, status: "invalid", reasons, mapped };
    return { row_number, status: "valid", reasons, mapped };
  });
}

export function stableHash(input: {
  campaign_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  job_title: string | null;
}): string {
  const parts = [
    input.campaign_id,
    input.email.toLowerCase(),
    (input.first_name ?? "").toLowerCase(),
    (input.last_name ?? "").toLowerCase(),
    (input.company ?? "").toLowerCase(),
    (input.job_title ?? "").toLowerCase(),
  ].join("|");
  return cryptoHash(parts);
}

function cryptoHash(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}
