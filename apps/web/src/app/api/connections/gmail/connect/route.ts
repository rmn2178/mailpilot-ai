import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { makeOAuthState, buildAuthorizeUrl } from "@mailpilot/server-core";
import { ok, failInternal } from "@/lib/api/responses";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const user = await requireAuth();
    const st = makeOAuthState(user.id);
    // Persist state for callback verification — store in a short-lived signed cookie via Set-Cookie.
    const url = buildAuthorizeUrl(st.state);
    const res = ok({ url });
    res.cookies.set("mp_oauth_state", JSON.stringify(st), {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });
    return res;
  } catch (e) {
    return failInternal((e as Error).message);
  }
}
