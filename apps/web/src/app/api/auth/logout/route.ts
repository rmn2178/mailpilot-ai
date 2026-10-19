import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const SESSION_COOKIE = "mp_session";

export async function POST() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
