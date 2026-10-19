import type { ProviderType } from "@mailpilot/shared";
import type { ReviewIssue } from "@mailpilot/shared";

export interface ProviderRequest {
  slot: string;
  systemPrompt: string;
  userPrompt: string;
  outputSchemaHint?: string;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

export interface ProviderResponse {
  text: string;
  usage: {
    tokens_in: number;
    tokens_out: number;
  } | null;
  model_id: string;
  provider: ProviderType;
  duration_ms: number;
  raw?: unknown;
}

export interface ReviewerResult {
  decision: "pass" | "revise" | "blocked" | "error";
  score: number | null;
  issues: ReviewIssue[];
  evidence_references: string[];
  summary: string;
  usage: { tokens_in: number; tokens_out: number } | null;
  raw: unknown;
  error_code: string | null;
}

export interface ProviderError extends Error {
  code: string;
  retryable: boolean;
  rate_limited: boolean;
  provider: ProviderType;
}

export function makeProviderError(
  provider: ProviderType,
  message: string,
  opts: { code?: string; retryable?: boolean; rate_limited?: boolean } = {},
): ProviderError {
  const err = new Error(message) as ProviderError;
  err.provider = provider;
  err.code = opts.code ?? "PROVIDER_ERROR";
  err.retryable = opts.retryable ?? false;
  err.rate_limited = opts.rate_limited ?? false;
  return err;
}
