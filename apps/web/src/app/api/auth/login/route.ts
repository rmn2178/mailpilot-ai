import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@mailpilot.ai";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "admin123";
const SESSION_SECRET = process.env.TOKEN_ENCRYPTION_KEY ?? "dev-secret";
const SESSION_COOKIE = "mp_session";

function makeToken(email: string): string {
  // Simple signed token: base64(email):base64(secret-hash)
  const payload = Buffer.from(JSON.stringify({ email, ts: Date.now() })).toString("base64url");
  const sig = Buffer.from(SESSION_SECRET + email).toString("base64url").slice(0, 16);
  return `${payload}.${sig}`;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { email, password } = body as { email?: string; password?: string };

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }

  if (email.trim().toLowerCase() !== ADMIN_EMAIL.toLowerCase() || password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const token = makeToken(email.trim().toLowerCase());
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });

  return NextResponse.json({ ok: true });
}
