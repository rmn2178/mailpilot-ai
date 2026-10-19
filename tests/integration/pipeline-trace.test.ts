import { describe, it, expect } from "vitest";
import {
  isLegalTransition,
  TICKET_TRANSITIONS,
  type TicketState,
} from "@mailpilot/shared";

/**
 * End-to-end pipeline verification test.
 *
 * Traces every state transition the codebase actually performs and asserts
 * each one is legal per the state machine. If any of these fail, the pipeline
 * will throw at runtime and the ticket will get stuck.
 */

// The happy path: queued → analyzing → drafting → humanizing → grok_reviews
//   → gemini_qa → quality_gate → pending_approval → approved → ready_to_send
//   → sending → sent
const HAPPY_PATH: Array<[TicketState, TicketState]> = [
  ["queued", "analyzing"],
  ["analyzing", "drafting"],
  ["drafting", "humanizing"],
  ["humanizing", "grok_reviews"],
  ["grok_reviews", "gemini_qa"],
  ["gemini_qa", "quality_gate"],
  ["quality_gate", "pending_approval"],
  ["pending_approval", "approved"],
  ["approved", "ready_to_send"],
  ["ready_to_send", "sending"],
  ["sending", "sent"],
];

// Auto-approval path: quality_gate → approved → ready_to_send → sending → sent
const AUTO_APPROVE_PATH: Array<[TicketState, TicketState]> = [
  ["quality_gate", "approved"],
  ["approved", "ready_to_send"],
  ["ready_to_send", "sending"],
  ["sending", "sent"],
];

// Revision loop: quality_gate → revising → humanizing → grok_reviews → …
const REVISION_LOOP: Array<[TicketState, TicketState]> = [
  ["quality_gate", "revising"],
  ["revising", "humanizing"],
  ["humanizing", "grok_reviews"],
];

// Failure paths from each stage
const FAILURE_PATHS: Array<[TicketState, TicketState]> = [
  ["analyzing", "needs_attention"],
  ["drafting", "needs_attention"],
  ["humanizing", "needs_attention"],
  ["grok_reviews", "needs_attention"],
  ["gemini_qa", "needs_attention"],
  ["quality_gate", "needs_attention"],
  ["revising", "needs_attention"],
  ["revising", "failed"],
  ["sending", "send_status_unknown"],
  ["sending", "needs_attention"],
  ["sending", "failed"],
];

// Manual revision from attention/approval states
const MANUAL_REVISION: Array<[TicketState, TicketState]> = [
  ["pending_approval", "needs_attention"],
  ["needs_attention", "revising"],
  ["quality_gate", "revising"],
];

// Reject paths — every rejectable state must go directly to cancelled
const REJECT_PATHS: Array<[TicketState, TicketState]> = [
  ["queued", "cancelled"],
  ["analyzing", "cancelled"],
  ["drafting", "cancelled"],
  ["humanizing", "cancelled"],
  ["grok_reviews", "cancelled"],
  ["gemini_qa", "cancelled"],
  ["quality_gate", "cancelled"],
  ["pending_approval", "cancelled"],
  ["approved", "cancelled"],
  ["ready_to_send", "cancelled"],
  ["gmail_draft_created", "cancelled"],
  ["needs_attention", "cancelled"],
  ["paused", "cancelled"],
  ["blocked", "cancelled"],
  ["retry_scheduled", "cancelled"],
  ["failed", "cancelled"],
];

// Gmail draft path
const DRAFT_PATH: Array<[TicketState, TicketState]> = [
  ["approved", "gmail_draft_created"],
  ["ready_to_send", "gmail_draft_created"],
  ["gmail_draft_created", "sending"],
];

// Direct send from approved (user clicks Send on an approved ticket)
const DIRECT_SEND_FROM_APPROVED: Array<[TicketState, TicketState]> = [
  ["approved", "sending"],
];

describe("pipeline: happy path", () => {
  for (const [from, to] of HAPPY_PATH) {
    it(`${from} → ${to} is legal`, () => {
      expect(isLegalTransition(from, to)).toBe(true);
    });
  }
});

describe("pipeline: auto-approval path", () => {
  for (const [from, to] of AUTO_APPROVE_PATH) {
    it(`${from} → ${to} is legal`, () => {
      expect(isLegalTransition(from, to)).toBe(true);
    });
  }
});

describe("pipeline: revision loop", () => {
  for (const [from, to] of REVISION_LOOP) {
    it(`${from} → ${to} is legal`, () => {
      expect(isLegalTransition(from, to)).toBe(true);
    });
  }
});

describe("pipeline: failure paths", () => {
  for (const [from, to] of FAILURE_PATHS) {
    it(`${from} → ${to} is legal`, () => {
      expect(isLegalTransition(from, to)).toBe(true);
    });
  }
});

describe("pipeline: manual revision", () => {
  for (const [from, to] of MANUAL_REVISION) {
    it(`${from} → ${to} is legal`, () => {
      expect(isLegalTransition(from, to)).toBe(true);
    });
  }
});

describe("pipeline: reject paths (all rejectable states → cancelled)", () => {
  for (const [from, to] of REJECT_PATHS) {
    it(`${from} → ${to} is legal`, () => {
      expect(isLegalTransition(from, to)).toBe(true);
    });
  }
});

describe("pipeline: gmail draft path", () => {
  for (const [from, to] of DRAFT_PATH) {
    it(`${from} → ${to} is legal`, () => {
      expect(isLegalTransition(from, to)).toBe(true);
    });
  }
});

describe("pipeline: direct send from approved", () => {
  for (const [from, to] of DIRECT_SEND_FROM_APPROVED) {
    it(`${from} → ${to} is legal`, () => {
      expect(isLegalTransition(from, to)).toBe(true);
    });
  }
});

describe("pipeline: terminal states", () => {
  it("sent is terminal (no outgoing transitions)", () => {
    expect(TICKET_TRANSITIONS.sent).toEqual([]);
  });

  it("cancelled is terminal (no outgoing transitions)", () => {
    expect(TICKET_TRANSITIONS.cancelled).toEqual([]);
  });
});

describe("pipeline: illegal transitions that must throw", () => {
  const ILLEGAL: Array<[TicketState, TicketState]> = [
    ["sent", "queued"],
    ["cancelled", "queued"],
    ["sent", "sending"],
    ["revising", "quality_gate"], // must go through humanizing → reviews → qa → gate
    ["queued", "needs_attention"], // queued only allows analyzing/paused/cancelled/failed/retry_scheduled
    ["approved", "needs_attention"], // approved only allows ready_to_send/sending/cancelled
    ["paused", "needs_attention"],
    ["blocked", "needs_attention"],
  ];
  for (const [from, to] of ILLEGAL) {
    it(`${from} → ${to} is illegal`, () => {
      expect(isLegalTransition(from, to)).toBe(false);
    });
  }
});
