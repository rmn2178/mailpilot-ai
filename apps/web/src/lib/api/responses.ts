import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data }, { status });
}

export function fail(code: string, message: string, status = 400, details?: unknown) {
  return NextResponse.json(
    { ok: false, error: { code, message, details } },
    { status },
  );
}

export function failFromZod(e: ZodError) {
  return fail("VALIDATION_ERROR", "Request validation failed", 400, e.issues);
}

export function failUnauthorized() {
  return fail("UNAUTHORIZED", "Authentication required", 401);
}

export function failForbidden() {
  return fail("FORBIDDEN", "Not allowed", 403);
}

export function failNotFound(what = "Resource") {
  return fail("NOT_FOUND", `${what} not found`, 404);
}

export function failInternal(message: string) {
  return fail("INTERNAL", message, 500);
}
