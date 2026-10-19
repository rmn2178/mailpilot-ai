import { describe, it, expect } from "vitest";
import { buildRfc2822 } from "@mailpilot/server-core";

describe("Gmail MIME construction", () => {
  it("builds a plain-text message", () => {
    const out = buildRfc2822({
      to: "you@example.com",
      from: "me@example.com",
      subject: "Hi",
      text: "Hello there",
    });
    expect(out).toContain("From: me@example.com");
    expect(out).toContain("To: you@example.com");
    expect(out).toContain("Subject: Hi");
    expect(out).toContain("Hello there");
    expect(out).toContain("text/plain");
  });

  it("builds a multipart/alternative when HTML provided", () => {
    const out = buildRfc2822({
      to: "you@example.com",
      from: "me@example.com",
      subject: "Hi",
      text: "plain",
      html: "<p>html</p>",
    });
    expect(out).toContain("multipart/alternative");
    expect(out).toContain("text/html");
  });

  it("builds a multipart/mixed when attachments present", () => {
    const out = buildRfc2822({
      to: "you@example.com",
      from: "me@example.com",
      subject: "Hi",
      text: "plain",
      attachments: [{ filename: "test.txt", mime: "text/plain", bytes: new Uint8Array([72, 105]) }],
    });
    expect(out).toContain("multipart/mixed");
    expect(out).toContain("attachment");
    expect(out).toContain("test.txt");
  });

  it("encodes non-ASCII subjects as RFC 2047 encoded-words", () => {
    const out = buildRfc2822({
      to: "you@example.com",
      from: "me@example.com",
      subject: "Héllo",
      text: "x",
    });
    expect(out).toContain("=?UTF-8?B?");
  });
});
