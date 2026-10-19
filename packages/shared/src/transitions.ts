import { TicketState } from "./enums";

/**
 * Allowed state transitions for a ticket.
 * Any transition not listed here MUST be rejected by the state machine.
 *
 * This table is the single source of truth for the pipeline. Every transition
 * the codebase performs is verified by tests/integration/pipeline-trace.test.ts.
 * If you add a transition here, add a test case there too.
 */
export const TICKET_TRANSITIONS: Record<TicketState, readonly TicketState[]> = {
  queued: ["analyzing", "paused", "cancelled", "failed", "retry_scheduled"],
  analyzing: ["drafting", "needs_attention", "paused", "failed", "retry_scheduled", "cancelled"],
  drafting: ["humanizing", "needs_attention", "failed", "retry_scheduled", "cancelled"],
  humanizing: ["grok_reviews", "needs_attention", "failed", "retry_scheduled", "cancelled"],
  grok_reviews: ["gemini_qa", "needs_attention", "failed", "retry_scheduled", "cancelled"],
  gemini_qa: ["quality_gate", "needs_attention", "failed", "retry_scheduled", "cancelled"],
  quality_gate: [
    "revising",
    "pending_approval",
    "approved",
    "needs_attention",
    "failed",
    "cancelled",
  ],
  revising: ["humanizing", "needs_attention", "failed"],
  pending_approval: ["approved", "cancelled", "blocked", "needs_attention"],
  approved: ["ready_to_send", "sending", "gmail_draft_created", "cancelled"],
  ready_to_send: [
    "gmail_draft_created",
    "sending",
    "cancelled",
    "needs_attention",
  ],
  gmail_draft_created: ["sending", "sent", "cancelled", "needs_attention"],
  sending: ["sent", "send_status_unknown", "failed", "needs_attention"],
  sent: [],
  send_status_unknown: ["sent", "failed", "needs_attention"],
  needs_attention: [
    "queued",
    "analyzing",
    "drafting",
    "humanizing",
    "pending_approval",
    "revising",
    "cancelled",
  ],
  paused: ["queued", "cancelled"],
  blocked: ["queued", "cancelled"],
  retry_scheduled: ["queued", "cancelled", "failed"],
  failed: ["queued", "cancelled"],
  cancelled: [],
};

export function isLegalTransition(
  from: TicketState,
  to: TicketState,
): boolean {
  const allowed = TICKET_TRANSITIONS[from] ?? [];
  return allowed.includes(to);
}

export function assertLegalTransition(
  from: TicketState,
  to: TicketState,
): void {
  if (!isLegalTransition(from, to)) {
    throw new Error(
      `Illegal ticket state transition: ${from} → ${to}. ` +
        `Allowed targets from ${from}: ${(TICKET_TRANSITIONS[from] ?? []).join(", ") || "(none)"}`,
    );
  }
}
