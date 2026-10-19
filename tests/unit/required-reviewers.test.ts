import { describe, it, expect } from "vitest";
import { resolveRequiredReviewers, DEFAULT_REQUIRED_REVIEWERS } from "@mailpilot/shared";

describe("required-reviewer resolution", () => {
  it("returns the configured list when non-empty", () => {
    const out = resolveRequiredReviewers(["grok_defensibility"]);
    expect(out).toEqual(["grok_defensibility"]);
  });

  it("falls back to DEFAULT_REQUIRED_REVIEWERS for undefined", () => {
    const out = resolveRequiredReviewers(undefined);
    expect(out).toEqual(DEFAULT_REQUIRED_REVIEWERS);
    expect(out.length).toBe(6);
  });

  it("falls back to DEFAULT_REQUIRED_REVIEWERS for null", () => {
    const out = resolveRequiredReviewers(null);
    expect(out).toEqual(DEFAULT_REQUIRED_REVIEWERS);
  });

  // Per §3 (4th-pass): the critical case. An empty array MUST fall back to the
  // full six-reviewer set. The bare `??` operator would return `[]`, which
  // silently collapses the entire six-reviewer pipeline.
  it("falls back to DEFAULT_REQUIRED_REVIEWERS for empty array (critical bug fix)", () => {
    const out = resolveRequiredReviewers([]);
    expect(out).toEqual(DEFAULT_REQUIRED_REVIEWERS);
    expect(out.length).toBe(6);
  });
});
