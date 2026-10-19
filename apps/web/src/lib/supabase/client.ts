import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/**
 * Browser-side Supabase client. Uses ONLY the publishable anon key — never
 * the service-role key. RLS enforces ownership server-side.
 *
 * Accepts either NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (Supabase's newer name)
 * or NEXT_PUBLIC_SUPABASE_ANON_KEY (the conventional name).
 */
export function getBrowserSupabase(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY (a.k.a. NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).",
    );
  }
  cached = createBrowserClient(url, anon);
  return cached;
}
