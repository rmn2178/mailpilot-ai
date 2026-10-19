import { z } from "zod";
import { getServiceSupabase } from "../db";
import type { ProviderType } from "@mailpilot/shared";

/**
 * Per-slot quota manager.
 *
 * - Tracks in-process request counts (token bucket per minute).
 * - Honors provider cooldown windows persisted in `provider_settings`.
 * - Does NOT pretend that two API keys give two independent quotas — when
 *   the upstream provider reports a shared project/account limit, we
 *   propagate the cooldown to every slot of that provider.
 *
 * This is best-effort throttling. Real provider limits are enforced
 * upstream; the manager exists to avoid hammering the API in tight loops.
 */

const QuotaRow = z.object({
  slot: z.string(),
  provider: z.enum(["gemini", "grok"]),
  enabled: z.boolean(),
  max_concurrency: z.number().int().min(1),
  request_budget_per_minute: z.number().int().min(1),
  cooldown_until: z.string().nullable(),
  last_error: z.string().nullable(),
});

export type QuotaRow = z.infer<typeof QuotaRow>;

const buckets = new Map<string, { tokens: number; last_refill: number }>();

function refill(bucket: { tokens: number; last_refill: number }, capacity: number) {
  const now = Date.now();
  const elapsed = now - bucket.last_refill;
  if (elapsed <= 0) return;
  const refill = (elapsed / 60_000) * capacity;
  bucket.tokens = Math.min(capacity, bucket.tokens + refill);
  bucket.last_refill = now;
}

export async function loadSlotConfig(slot: string): Promise<QuotaRow | null> {
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from("provider_settings")
    .select("*")
    .eq("slot", slot)
    .maybeSingle();
  if (error) throw new Error(`Quota load failed for ${slot}: ${error.message}`);
  if (!data) return null;
  return QuotaRow.parse(data);
}

export async function acquireSlot(slot: string): Promise<void> {
  const cfg = await loadSlotConfig(slot);
  if (!cfg) throw new Error(`No provider config for slot ${slot}`);
  if (!cfg.enabled) throw new Error(`Slot ${slot} is disabled`);
  if (cfg.cooldown_until && new Date(cfg.cooldown_until).getTime() > Date.now()) {
    throw new Error(
      `Slot ${slot} is in provider cooldown until ${cfg.cooldown_until}`,
    );
  }
  let bucket = buckets.get(slot);
  if (!bucket) {
    bucket = {
      tokens: cfg.request_budget_per_minute,
      last_refill: Date.now(),
    };
    buckets.set(slot, bucket);
  }
  refill(bucket, cfg.request_budget_per_minute);
  if (bucket.tokens < 1) {
    const err = new Error(`Rate bucket empty for ${slot}`) as Error & {
      rate_limited: boolean;
      retryable: boolean;
    };
    err.rate_limited = true;
    err.retryable = true;
    throw err;
  }
  bucket.tokens -= 1;
}

export async function reportProviderCooldown(
  provider: ProviderType,
  retryAfterMs: number,
  reason: string,
): Promise<void> {
  // Persist cooldown to every slot of this provider.
  const sb = getServiceSupabase();
  const until = new Date(Date.now() + retryAfterMs).toISOString();
  const { error } = await sb
    .from("provider_settings")
    .update({ cooldown_until: until, last_error: reason })
    .eq("provider", provider);
  if (error) {
    console.error("[quota] could not persist cooldown:", error.message);
  }
}

export async function reportSuccess(slot: string): Promise<void> {
  const sb = getServiceSupabase();
  const { error } = await sb
    .from("provider_settings")
    .update({ cooldown_until: null, last_error: null })
    .eq("slot", slot);
  if (error) {
    console.error("[quota] could not clear cooldown:", error.message);
  }
}
