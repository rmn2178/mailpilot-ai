/**
 * Optional dependency declarations for pdf-parse and mammoth.
 *
 * Both packages are dynamic-imported at runtime in documents/index.ts. They
 * are listed as optional peer dependencies — install them to enable PDF/DOCX
 * extraction. Without them, the extractors return a clear failure message.
 */
declare module "pdf-parse" {
  const fn: (buf: Buffer) => Promise<{ text: string; numpages: number }>;
  export default fn;
}

declare module "mammoth" {
  export function extractRawText(opts: {
    buffer: Buffer;
  }): Promise<{
    value: string;
    messages: Array<{ message: string }>;
  }>;
}
