import { cookies } from "next/headers";

const SESSION_COOKIE = "mp_session";
const SESSION_SECRET = process.env.TOKEN_ENCRYPTION_KEY ?? "dev-secret";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@mailpilot.ai";

// Fixed UUID for the single admin profile row (matches migration 0010).
const ADMIN_UUID = "00000000-0000-0000-0000-000000000001";

function parseToken(token: string): { email: string } | null {
  try {
    const [payload, sig] = token.split(".");
    if (!payload || !sig) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    const expectedSig = Buffer.from(SESSION_SECRET + data.email).toString("base64url").slice(0, 16);
    if (sig !== expectedSig) return null;
    return { email: data.email };
  } catch {
    return null;
  }
}

export async function requireUser(): Promise<{ id: string; email: string }> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) throw new Error("Unauthorized");
  const parsed = parseToken(token);
  if (!parsed) throw new Error("Unauthorized");
  // Always return the fixed admin UUID so all owner_id FK references work.
  return { id: ADMIN_UUID, email: parsed.email };
}

export function getAdminEmail(): string {
  return ADMIN_EMAIL;
}
