import { getServiceSupabase } from "../db";

/**
 * Persistent usage tracking — tokens, durations, cost estimates per call.
 * Used by the Usage & Costs settings tab and by quota-aware decisions.
 *
 * Cost numbers are advisory estimates from public model pricing pages.
 * They are NOT authoritative billing data.
 */

const APPROX_COST_USD_PER_1K_TOKENS: Record<string, { in: number; out: number }> = {
  "gemini-1.5-pro": { in: 0.00125, out: 0.005 },
  "gemini-1.5-flash": { in: 0.000075, out: 0.0003 },
  "grok-2-latest": { in: 0.002, out: 0.01 },
};

export function estimateCost(
  modelId: string,
  tokensIn: number,
  tokensOut: number,
): number {
  const c = APPROX_COST_USD_PER_1K_TOKENS[modelId];
  if (!c) return 0;
  return (tokensIn / 1000) * c.in + (tokensOut / 1000) * c.out;
}

export interface UsageInsert {
  campaign_id: string | null;
  ticket_id: string | null;
  slot: string;
  provider: "gemini" | "grok";
  model_id: string;
  tokens_in: number;
  tokens_out: number;
  duration_ms: number;
  cost_estimate_usd: number;
}

export async function recordUsage(u: UsageInsert): Promise<void> {
  const sb = getServiceSupabase();
  const { error } = await sb.from("usage_records").insert({
    ...u,
    created_at: new Date().toISOString(),
  });
  if (error) {
    console.error("[usage] insert failed:", error.message);
  }
}
