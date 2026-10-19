import type { ReviewerRole, ReviewDecision, ProviderType } from "../enums";

export interface ReviewIssue {
  severity: "info" | "warning" | "error" | "critical";
  code: string;
  message: string;
  quoted_text?: string;
  evidence: string[];
}

export interface AiReview {
  id: string;
  ticket_id: string;
  email_version_id: string;
  reviewer_role: ReviewerRole;
  provider: ProviderType;
  model_id: string;
  status: "running" | "completed" | "failed" | "timeout";
  score: number | null;
  decision: ReviewDecision;
  issues: ReviewIssue[];
  evidence_references: string[];
  summary: string;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  usage_metadata: Record<string, unknown> | null;
  error_code: string | null;
}

export interface AiSlotConfig {
  slot: string;
  provider: ProviderType;
  model_id: string;
  credential_slot: 1 | 2 | 3 | 4;
  enabled: boolean;
  max_concurrency: number;
  request_budget_per_minute: number;
  timeout_ms: number;
  retry: {
    max_attempts: number;
    base_delay_ms: number;
    max_delay_ms: number;
  };
  availability: {
    available: boolean;
    last_error: string | null;
    cooldown_until: string | null;
  };
  measured: {
    p50_latency_ms: number | null;
    p95_latency_ms: number | null;
    tokens_in: number;
    tokens_out: number;
  };
}

export interface UsageRecord {
  id: string;
  campaign_id: string | null;
  ticket_id: string | null;
  slot: string;
  provider: ProviderType;
  model_id: string;
  tokens_in: number;
  tokens_out: number;
  duration_ms: number;
  cost_estimate_usd: number;
  created_at: string;
}
