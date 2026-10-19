import { describe, it, expect } from "vitest";
import { encryptSecret, decryptSecret } from "@mailpilot/server-core";

// These tests require TOKEN_ENCRYPTION_KEY to be at least 32 chars,
// and minimal Supabase env vars so loadEnv() passes.
process.env.TOKEN_ENCRYPTION_KEY =
  process.env.TOKEN_ENCRYPTION_KEY ?? "test-key-must-be-at-least-32-bytes-long!!";
process.env.NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "test-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "test-service";

describe("credential encryption", () => {
  it("round-trips a secret", () => {
    const enc = encryptSecret("my-refresh-token");
    expect(enc).not.toBe("my-refresh-token");
    expect(enc.split(".")).toHaveLength(2);
    expect(decryptSecret(enc)).toBe("my-refresh-token");
  });

  it("produces different ciphertexts for the same input (random IV)", () => {
    const a = encryptSecret("x");
    const b = encryptSecret("x");
    expect(a).not.toBe(b);
  });
});
