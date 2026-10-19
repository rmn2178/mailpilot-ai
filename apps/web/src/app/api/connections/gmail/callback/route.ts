import { NextResponse } from "next/server";
import { exchangeCodeForTokens, persistSenderAccount, requireServerEnv } from "@mailpilot/server-core";
import { ok, fail, failInternal } from "@/lib/api/responses";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    if (error) return fail("OAUTH_ERROR", error, 400);
    if (!code || !state) return fail("OAUTH_ERROR", "Missing code or state", 400);

    const store = await cookies();
    const cookieState = store.get("mp_oauth_state")?.value;
    if (!cookieState) return fail("OAUTH_ERROR", "State cookie missing", 400);
    let parsed: { state: string; user_id: string };
    try {
      parsed = JSON.parse(cookieState);
    } catch {
      return fail("OAUTH_ERROR", "State cookie malformed", 400);
    }
    if (parsed.state !== state) return fail("OAUTH_ERROR", "State mismatch", 400);
    store.delete("mp_oauth_state");

    const tokens = await exchangeCodeForTokens(code);
    // Fetch user email from id_token
    const env = requireServerEnv();
    void env;
    const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = (await profileRes.json()) as { email?: string };
    if (!profile.email) return fail("OAUTH_ERROR", "Could not read Gmail address", 400);

    await persistSenderAccount(parsed.user_id, profile.email, tokens);

    return NextResponse.redirect(new URL("/connections", req.url));
  } catch (e) {
    return failInternal((e as Error).message);
  }
}
