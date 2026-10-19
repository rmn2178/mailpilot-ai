import { getServiceSupabase } from "./db";

/**
 * Append-only audit log. Every privileged action — state transitions, approval
 * decisions, send attempts, credential use, OAuth connect/disconnect — MUST
 * write a row here. Secrets are redacted by `redact()`.
 */

export interface AuditEntry {
  actor_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  campaign_id: string | null;
  ticket_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

const SECRET_KEYS = /(api[_-]?key|token|secret|password|refresh[_-]?token|authorization|access[_-]?token|bearer|credential)/i;

/**
 * Redact secrets from audit metadata.
 *
 * Rules:
 *   - Object values whose KEY looks like a secret are replaced with "***".
 *   - Standalone strings are NOT redacted (they could be filenames, subjects,
 *     etc.). Redaction is driven by key names, not value content.
 *   - Arrays are walked element-by-element.
 *
 * Short standalone strings used to be redacted; that broke legitimate audit
 * data (filenames, short messages). The new behavior is conservative: only
 * key-driven redaction.
 */
export function redact(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) ? "***" : redact(v);
    }
    return out;
  }
  return value;
}

export async function audit(entry: Omit<AuditEntry, "created_at">): Promise<void> {
  const sb = getServiceSupabase();
  const payload: AuditEntry = {
    ...entry,
    metadata: redact(entry.metadata) as Record<string, unknown>,
    created_at: new Date().toISOString(),
  };
  const { error } = await sb.from("audit_log").insert(payload);
  if (error) {
    // Audit failure must NOT silently pass; surface in logs but do not throw
    // — throwing on audit could mask the original operation outcome.
    console.error("[audit] write failed:", error.message, payload);
  }
}
