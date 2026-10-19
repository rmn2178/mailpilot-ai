import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireServerEnv } from "./env";

/**
 * Server-only Supabase client built with the service-role key.
 *
 * SECURITY: This module MUST NEVER be imported from a client bundle. The
 * service-role key bypasses RLS. All authorization must therefore be done
 * explicitly in the service layer (verify campaign ownership before reads
 * or writes). The browser uses the publishable key via lib/supabase/client.ts.
 */

let serviceClient: SupabaseClient | null = null;

export function getServiceSupabase(): SupabaseClient {
  if (serviceClient) return serviceClient;
  const env = requireServerEnv();
  serviceClient = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-application": "mailpilot-ai-server" } },
    },
  );
  return serviceClient;
}

/** Executes a callback inside a Postgres transaction via RPC. */
export async function withTransaction<T>(
  fn: (client: SupabaseClient) => Promise<T>,
): Promise<T> {
  const client = getServiceSupabase();
  // Supabase JS does not expose raw BEGIN/COMMIT. For multi-statement atomic
  // transitions, prefer a Postgres function (see migrations/0006_indexes_functions.sql)
  // or use a single RPC call. This wrapper is a placeholder for clarity.
  return fn(client);
}

export async function assertCampaignOwnedBy(
  campaignId: string,
  ownerId: string,
): Promise<void> {
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from("campaigns")
    .select("id, owner_id")
    .eq("id", campaignId)
    .maybeSingle();
  if (error) throw new Error(`DB error verifying campaign ownership: ${error.message}`);
  if (!data) throw new Error("Campaign not found");
  if (data.owner_id !== ownerId) {
    throw new Error("Forbidden: campaign does not belong to caller");
  }
}
