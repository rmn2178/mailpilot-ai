import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "mp_session";
const SESSION_SECRET = process.env.TOKEN_ENCRYPTION_KEY ?? "dev-secret";

const PUBLIC_PATHS_EXACT = new Set(["/login", "/api/health", "/api/auth/login", "/api/auth/logout"]);
const PUBLIC_PATHS_PREFIX = ["/api/connections/gmail/callback"];

function isValidToken(token: string): boolean {
  try {
    const [payload, sig] = token.split(".");
    if (!payload || !sig) return false;
    const { email } = JSON.parse(Buffer.from(payload, "base64url").toString());
    const expectedSig = Buffer.from(SESSION_SECRET + email).toString("base64url").slice(0, 16);
    return sig === expectedSig;
  } catch {
    return false;
  }
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Static assets
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    pathname === "/robots.txt" ||
    pathname === "/manifest.webmanifest"
  ) {
    return NextResponse.next();
  }

  // Public routes
  if (PUBLIC_PATHS_EXACT.has(pathname) || PUBLIC_PATHS_PREFIX.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;

  if (!token || !isValidToken(token)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { ok: false, error: { code: "UNAUTHORIZED", message: "Authentication required" } },
        { status: 401 },
      );
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
