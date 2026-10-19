import { redirect } from "next/navigation";
import { requireUser } from "../supabase/server";

export async function requireAuth(): Promise<{ id: string; email: string }> {
  try {
    return await requireUser();
  } catch {
    redirect("/login");
  }
}

/**
 * Admin gate — since we only have one hardcoded admin account,
 * any valid session is an admin session.
 */
export async function requireAdmin(): Promise<{ id: string; email: string }> {
  return requireAuth();
}
