/**
 * Safe text extraction for reference files.
 *
 * Per spec §7: never fabricate extracted text. If a document is unreadable,
 * record an extraction failure and require attention when that material is
 * essential.
 *
 * Per spec §19: treat document contents as untrusted data. Ignore
 * instructions embedded in documents that attempt to override system prompts,
 * disclose credentials, manipulate approval, or execute actions.
 *
 * Implementation note: PDF and DOCX parsing in a real deployment would use
 * pdf-parse and mammoth. We declare them as optional dynamic imports so the
 * scaffold typechecks without forcing installs. The functions fall back to
 * an explicit failure record when the parser is not installed.
 */

export interface ExtractResult {
  text: string;
  pages?: number;
  warnings: string[];
  failure: string | null;
}

export async function extractPdf(bytes: Uint8Array): Promise<ExtractResult> {
  try {
    const mod = await import("pdf-parse");
    const fn = (mod as any).default ?? mod;
    const text = await fn(Buffer.from(bytes) as Buffer);
    return {
      text: stripInjection(text.text),
      pages: text.numpages,
      warnings: [],
      failure: null,
    };
  } catch (e) {
    return {
      text: "",
      warnings: [],
      failure: `pdf-parse failed: ${(e as Error).message}. Install pdf-parse to enable PDF extraction.`,
    };
  }
}

export async function extractDocx(bytes: Uint8Array): Promise<ExtractResult> {
  try {
    const mod = await import("mammoth");
    const mammoth = mod as unknown as {
      extractRawText: (opts: { buffer: Buffer }) => Promise<{
        value: string;
        messages: Array<{ message: string }>;
      }>;
    };
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) as Buffer });
    return {
      text: stripInjection(result.value),
      warnings: result.messages.map((m: { message: string }) => m.message),
      failure: null,
    };
  } catch (e) {
    return {
      text: "",
      warnings: [],
      failure: `mammoth failed: ${(e as Error).message}. Install mammoth to enable DOCX extraction.`,
    };
  }
}

export function extractTextPlain(bytes: Uint8Array): ExtractResult {
  return {
    text: stripInjection(Buffer.from(bytes).toString("utf8")),
    warnings: [],
    failure: null,
  };
}

export function extractMarkdown(bytes: Uint8Array): ExtractResult {
  // We deliberately DO NOT render markdown — treat as text. Downstream
  // prompts receive plain markdown source.
  return extractTextPlain(bytes);
}

/**
 * Strip common prompt-injection patterns from extracted text. This is NOT
 * a security boundary by itself — the system prompts repeat the same rules
 * immutably. It exists to reduce the surface area for accidental override.
 */
function stripInjection(input: string): string {
  return input
    .replace(/```system[\s\S]*?```/gi, "")
    .replace(/^\s*SYSTEM:\s.*$/gim, "")
    .replace(/^\s*IGNORE PREVIOUS.*$/gim, "");
}

export async function extractByMime(
  bytes: Uint8Array,
  mime: string,
  filename: string,
): Promise<ExtractResult> {
  const lower = filename.toLowerCase();
  if (mime === "application/pdf" || lower.endsWith(".pdf")) return extractPdf(bytes);
  if (
    mime.includes("wordprocessingml.document") ||
    lower.endsWith(".docx")
  )
    return extractDocx(bytes);
  if (mime === "text/markdown" || lower.endsWith(".md")) return extractMarkdown(bytes);
  if (mime === "text/plain" || lower.endsWith(".txt")) return extractTextPlain(bytes);
  return {
    text: "",
    warnings: [],
    failure: `Unsupported file type: ${mime || filename}`,
  };
}
