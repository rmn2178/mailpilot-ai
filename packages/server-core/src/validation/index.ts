import { z } from "zod";
import {
  CampaignSettingsSchema,
  AiSlotConfigSchema,
  ImportRowSchema,
} from "@mailpilot/shared";

export const validateCampaignSettings = (raw: unknown) =>
  CampaignSettingsSchema.safeParse(raw);

export const validateAiSlotConfig = (raw: unknown) =>
  AiSlotConfigSchema.safeParse(raw);

export const validateImportRows = (raw: unknown) =>
  z.array(ImportRowSchema).safeParse(raw);

const EmailSchema = z.string().email();

export function isEmail(v: unknown): v is string {
  return EmailSchema.safeParse(v).success;
}

// ─── HTML sanitization ─────────────────────────────────────────────────────

const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "strong",
  "em",
  "u",
  "a",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "span",
  "div",
]);

/**
 * Minimal HTML sanitizer. Strips <script>, on* attributes, javascript: URLs,
 * and unknown tags. For a production deployment prefer DOMPurify on the
 * server via jsdom; this is a conservative fallback suitable for the scaffold.
 *
 * Note: regex-based sanitization is NOT a security boundary for arbitrary
 * HTML. We rely on it only for AI-generated email bodies (where the input
 * is already constrained by the AI prompt). For user-supplied HTML, use
 * DOMPurify on the server via jsdom.
 */
export function sanitizeHtml(html: string): string {
  return html
    // Strip <script>...</script> and <style>...</style> with content
    .replace(/<\s*script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<\s*script\b[^>]*>/gi, "")
    .replace(/<\s*style[\s\S]*?<\/style\s*>/gi, "")
    .replace(/<\s*style\b[^>]*>/gi, "")
    // Strip iframe/object/embed (both open and close tags)
    .replace(/<\s*\/?\s*iframe\b[^>]*>/gi, "")
    .replace(/<\s*\/?\s*object\b[^>]*>/gi, "")
    .replace(/<\s*\/?\s*embed\b[^>]*>/gi, "")
    // Strip on* event handler attributes
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, "")
    // Strip javascript: and data: URLs from href/src attributes
    .replace(/javascript:/gi, "")
    .replace(/(href|src)\s*=\s*["']\s*data:/gi, '$1="removed:"')
    // Strip unknown tags (not in ALLOWED_TAGS). Keep their text content.
    .replace(/<\s*\/?\s*(\w+)[^>]*>/g, (match, tag) => {
      const t = tag.toLowerCase();
      return ALLOWED_TAGS.has(t) ? match : "";
    })
    // Clean up any leftover empty angle brackets
    .replace(/<\s*>/g, "")
    .replace(/<\s*\/\s*>/g, "")
    .trim();
}
