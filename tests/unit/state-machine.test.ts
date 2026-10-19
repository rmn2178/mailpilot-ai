import { describe, it, expect } from "vitest";
import {
  isLegalTransition,
  assertLegalTransition,
} from "@mailpilot/shared";

describe("ticket state machine", () => {
  it("allows queued → analyzing", () => {
    expect(isLegalTransition("queued", "analyzing")).toBe(true);
  });

  it("forbids sent → queued (terminal state)", () => {
    expect(isLegalTransition("sent", "queued")).toBe(false);
  });

  it("forbids cancelled → anything (terminal)", () => {
    expect(isLegalTransition("cancelled", "queued")).toBe(false);
  });

  it("allows pending_approval → approved → ready_to_send → sending → sent", () => {
    expect(isLegalTransition("pending_approval", "approved")).toBe(true);
    expect(isLegalTransition("approved", "ready_to_send")).toBe(true);
    expect(isLegalTransition("ready_to_send", "sending")).toBe(true);
    expect(isLegalTransition("sending", "sent")).toBe(true);
  });

  it("allows quality_gate → revising → humanizing (revision loop)", () => {
    expect(isLegalTransition("quality_gate", "revising")).toBe(true);
    expect(isLegalTransition("revising", "humanizing")).toBe(true);
  });

  // Per §4 (4th-pass): the revision route routes pending_approval →
  // needs_attention → revising. The second hop must be legal.
  it("allows needs_attention → revising (manual revision from attention state)", () => {
    expect(isLegalTransition("needs_attention", "revising")).toBe(true);
  });

  it("allows needs_attention → queued (recovery reset)", () => {
    expect(isLegalTransition("needs_attention", "queued")).toBe(true);
  });

  it("throws on illegal transition", () => {
    expect(() => assertLegalTransition("sent", "queued")).toThrow();
  });
});
