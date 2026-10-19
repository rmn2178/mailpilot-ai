import { describe, it, expect } from "vitest";
import { redact } from "@mailpilot/server-core";

describe("audit redaction", () => {
  it("redacts keys that look like secrets", () => {
    const out = redact({
      api_key: "sk-1234567890abcdef",
      refresh_token: "rt-abcdef",
      access_token: "at-xyz",
      normal: "hello",
    }) as Record<string, unknown>;
    expect(out.api_key).toBe("***");
    expect(out.refresh_token).toBe("***");
    expect(out.access_token).toBe("***");
    expect(out.normal).toBe("hello");
  });

  it("walks nested objects", () => {
    const out = redact({
      outer: {
        password: "hunter2",
        visible: "ok",
      },
    }) as { outer: Record<string, unknown> };
    expect(out.outer.password).toBe("***");
    expect(out.outer.visible).toBe("ok");
  });

  it("walks arrays", () => {
    const out = redact({
      items: [
        { token: "abc", label: "first" },
        { token: "def", label: "second" },
      ],
    }) as { items: Array<Record<string, unknown>> };
    expect(out.items[0].token).toBe("***");
    expect(out.items[0].label).toBe("first");
  });

  it("does not redact standalone strings (could be filenames)", () => {
    expect(redact("hello.txt")).toBe("hello.txt");
    expect(redact("a normal subject line")).toBe("a normal subject line");
  });
});
