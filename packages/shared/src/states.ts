import { TicketState } from "./enums";

/**
 * Stage grouping — used by the pipeline UI to map persisted ticket state
 * to a single high-level stage label.
 */
export const STAGE_BY_STATE: Record<TicketState, string> = {
  queued: "queued",
  analyzing: "analysis",
  drafting: "draft",
  humanizing: "humanization",
  grok_reviews: "grok_reviews",
  gemini_qa: "gemini_qa",
  quality_gate: "quality_gate",
  revising: "quality_gate",
  pending_approval: "approval",
  approved: "approval",
  ready_to_send: "delivery",
  gmail_draft_created: "delivery",
  sending: "delivery",
  sent: "delivery",
  send_status_unknown: "delivery",
  needs_attention: "needs_attention",
  paused: "paused",
  blocked: "blocked",
  retry_scheduled: "queued",
  failed: "failed",
  cancelled: "cancelled",
};

export const TERMINAL_STATES: ReadonlySet<TicketState> = new Set([
  "sent",
  "cancelled",
]);

export const ATTENTION_STATES: ReadonlySet<TicketState> = new Set([
  "needs_attention",
  "blocked",
  "failed",
  "send_status_unknown",
]);

export const ACTIVE_PROCESSING_STATES: ReadonlySet<TicketState> = new Set([
  "analyzing",
  "drafting",
  "humanizing",
  "grok_reviews",
  "gemini_qa",
  "quality_gate",
  "revising",
  "sending",
]);
