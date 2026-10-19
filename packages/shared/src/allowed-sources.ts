/**
 * Sets of states from which a user-initiated revision or reject is allowed.
 *
 * Exported so the UI can mirror the API's allowed-source lists exactly —
 * otherwise buttons get enabled for states the API will reject with 400
 * (silent failures that look like the click did nothing).
 */

export const ALLOWED_REVISION_SOURCES: readonly string[] = [
  "quality_gate",
  "pending_approval",
  "needs_attention",
];

export const REJECTABLE_SOURCES: readonly string[] = [
  "queued",
  "analyzing",
  "drafting",
  "humanizing",
  "grok_reviews",
  "gemini_qa",
  "quality_gate",
  "pending_approval",
  "approved",
  "ready_to_send",
  "gmail_draft_created",
  "needs_attention",
  "paused",
  "blocked",
  "retry_scheduled",
  "failed",
];
