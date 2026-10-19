import { describe, it, expect } from "vitest";
import { validateRows, stableHash, type ColumnMapping } from "@mailpilot/server-core";

describe("spreadsheet validation", () => {
  const mapping: ColumnMapping = {
    email: "Email",
    first_name: "First",
    last_name: "Last",
    company: "Company",
    job_title: "Title",
  };

  it("flags missing email", () => {
    const results = validateRows(
      [{ Email: "", First: "Jane" }],
      mapping,
    );
    expect(results[0].status).toBe("invalid");
    expect(results[0].reasons).toContain("missing email");
  });

  it("flags malformed email", () => {
    const results = validateRows([{ Email: "not-an-email" }], mapping);
    expect(results[0].status).toBe("invalid");
  });

  it("flags duplicate email within the same import", () => {
    const results = validateRows(
      [{ Email: "a@b.com" }, { Email: "a@b.com" }],
      mapping,
    );
    expect(results[0].status).toBe("valid");
    expect(results[1].status).toBe("duplicate");
  });

  it("flags all-empty rows", () => {
    const results = validateRows(
      [{ Email: "", First: "", Last: "", Company: "", Title: "" }],
      mapping,
    );
    expect(results[0].status).toBe("empty");
  });

  it("marks a clean row as valid", () => {
    const results = validateRows(
      [{ Email: "a@b.com", First: "A", Last: "B", Company: "C", Title: "T" }],
      mapping,
    );
    expect(results[0].status).toBe("valid");
  });

  it("stable hash is deterministic for identical content", () => {
    const a = stableHash({
      campaign_id: "c1",
      email: "A@B.com",
      first_name: "John",
      last_name: "Doe",
      company: "Acme",
      job_title: "CEO",
    });
    const b = stableHash({
      campaign_id: "c1",
      email: "a@b.com",
      first_name: "john",
      last_name: "doe",
      company: "acme",
      job_title: "ceo",
    });
    expect(a).toBe(b);
  });
});
