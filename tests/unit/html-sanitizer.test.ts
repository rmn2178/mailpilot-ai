import { describe, it, expect } from "vitest";
import { sanitizeHtml } from "@mailpilot/server-core";

describe("HTML sanitization", () => {
  it("strips <script> tags", () => {
    expect(sanitizeHtml("<script>alert(1)</script><p>hi</p>")).toBe("<p>hi</p>");
  });
  it("strips on* attributes", () => {
    const out = sanitizeHtml('<a href="x" onclick="alert(1)">x</a>');
    expect(out).not.toContain("onclick");
  });
  it("strips javascript: URLs", () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).not.toContain("javascript:");
  });
  it("strips <iframe>", () => {
    expect(sanitizeHtml('<iframe src="x"></iframe><p>ok</p>')).toBe("<p>ok</p>");
  });
});
