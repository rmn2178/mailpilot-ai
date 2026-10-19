import { describe, it, expect } from "vitest";
import { aggregateReviews } from "@mailpilot/server-core";
import type { AiReview } from "@mailpilot/shared";

function mk(role: string, decision: AiReview["decision"], score: number | null = 80): AiReview {
  return {
    id: "r-" + role,
    ticket_id: "t1",
    email_version_id: "v1",
    reviewer_role: role as AiReview["reviewer_role"],
    provider: "grok",
    model_id: "grok-2-latest",
    status: "completed",
    score,
    decision,
    issues: [],
    evidence_references: [],
    summary: "",
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    duration_ms: 100,
    usage_metadata: null,
    error_code: null,
  };
}

describe("review aggregation", () => {
  it("passes when all required reviewers pass and scores >= min", () => {
    const out = aggregateReviews(
      [mk("grok_defensibility", "pass"), mk("grok_human_tone", "pass")],
      ["grok_defensibility", "grok_human_tone"],
      70,
    );
    expect(out.final).toBe("pass");
    expect(out.failed_reviewers).toHaveLength(0);
  });

  it("revise when a required reviewer is missing", () => {
    const out = aggregateReviews(
      [mk("grok_defensibility", "pass")],
      ["grok_defensibility", "grok_human_tone"],
      70,
    );
    expect(out.final).toBe("revise");
    expect(out.failed_reviewers).toContain("grok_human_tone");
  });

  it("revise when a score is below threshold", () => {
    const out = aggregateReviews(
      [mk("grok_defensibility", "pass", 50)],
      ["grok_defensibility"],
      70,
    );
    expect(out.final).toBe("revise");
  });

  it("blocked when a required reviewer errored", () => {
    const out = aggregateReviews(
      [mk("grok_defensibility", "error")],
      ["grok_defensibility"],
      70,
    );
    expect(out.final).toBe("blocked");
  });

  it("blocks when a critical issue is present (per §13)", () => {
    const reviewWithCritical = { ...mk("grok_defensibility", "pass"), issues: [{ severity: "critical", code: "X", message: "Y", evidence: [] }] };
    const out = aggregateReviews([reviewWithCritical], ["grok_defensibility"], 70);
    expect(out.has_critical).toBe(true);
    // Per §13: critical issues BLOCK approval — they do not trigger a revision cycle.
    expect(out.final).toBe("blocked");
  });

  it("blocks when a required reviewer errored", () => {
    const out = aggregateReviews(
      [mk("grok_defensibility", "error")],
      ["grok_defensibility"],
      70,
    );
    expect(out.final).toBe("blocked");
  });

  it("blocks when a reviewer returns decision=blocked", () => {
    const out = aggregateReviews(
      [mk("grok_defensibility", "blocked"), mk("grok_human_tone", "pass")],
      ["grok_defensibility", "grok_human_tone"],
      70,
    );
    expect(out.final).toBe("blocked");
  });
});
