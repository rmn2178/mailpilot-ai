import { z } from "zod";

// ─── Contact & import ──────────────────────────────────────────────────────

export const ContactSchema = z.object({
  id: z.string().uuid(),
  campaign_id: z.string().uuid(),
  email: z.string().email(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
  job_title: z.string().nullable().optional(),
  custom_fields: z.record(z.string(), z.unknown()).nullable().optional(),
  stable_hash: z.string(),
  created_at: z.string(),
});

export const ImportRowSchema = z.object({
  row_number: z.number().int().min(1),
  raw: z.record(z.string(), z.unknown()),
  mapped: z
    .object({
      email: z.string().nullable(),
      first_name: z.string().nullable().optional(),
      last_name: z.string().nullable().optional(),
      company: z.string().nullable().optional(),
      job_title: z.string().nullable().optional(),
    })
    .partial(),
  status: z.enum(["valid", "invalid", "duplicate", "empty"]),
  reasons: z.array(z.string()).default([]),
});

// ─── Email version ──────────────────────────────────────────────────────────

export const EmailVersionSchema = z.object({
  id: z.string().uuid(),
  ticket_id: z.string().uuid(),
  version_number: z.number().int().min(1),
  subject: z.string(),
  body_plain: z.string(),
  body_html: z.string().nullable().optional(),
  source_references: z.array(z.unknown()).default([]),
  attachment_manifest: z.array(z.string()).default([]),
  created_by: z.enum(["ai", "human", "system"]).default("ai"),
  created_at: z.string(),
});

// ─── AI review ──────────────────────────────────────────────────────────────

export const ReviewIssueSchema = z.object({
  severity: z.enum(["info", "warning", "error", "critical"]),
  code: z.string(),
  message: z.string(),
  quoted_text: z.string().optional(),
  evidence: z.array(z.string()).default([]),
});

export const AiReviewSchema = z.object({
  ticket_id: z.string().uuid(),
  email_version_id: z.string().uuid(),
  reviewer_role: z.string(),
  provider: z.enum(["gemini", "grok"]),
  model_id: z.string(),
  status: z.enum(["running", "completed", "failed", "timeout"]),
  score: z.number().min(0).max(100).nullable(),
  decision: z.enum(["pass", "revise", "blocked", "error"]),
  issues: z.array(ReviewIssueSchema).default([]),
  evidence_references: z.array(z.string()).default([]),
  summary: z.string(),
  started_at: z.string(),
  completed_at: z.string().nullable(),
  duration_ms: z.number().nullable(),
  usage_metadata: z.record(z.string(), z.unknown()).nullable(),
  error_code: z.string().nullable(),
});

// ─── Workflow event ────────────────────────────────────────────────────────

export const WorkflowEventSchema = z.object({
  id: z.string().uuid(),
  ticket_id: z.string().uuid().nullable().optional(),
  campaign_id: z.string().uuid().nullable().optional(),
  stage: z.string(),
  event_type: z.string(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  error: z.string().nullable(),
  created_at: z.string(),
});

// ─── Send operation ────────────────────────────────────────────────────────

export const SendOperationSchema = z.object({
  id: z.string().uuid(),
  ticket_id: z.string().uuid(),
  email_version_id: z.string().uuid(),
  operation_id: z.string(),
  status: z.enum(["queued", "sending", "sent", "failed", "unknown", "reconciling"]),
  gmail_message_id: z.string().nullable().optional(),
  gmail_draft_id: z.string().nullable().optional(),
  attempt: z.number().int().min(1),
  attempted_at: z.string().nullable(),
  reconciled_at: z.string().nullable(),
  error: z.string().nullable(),
});

// ─── API responses ──────────────────────────────────────────────────────────

export function ok<T extends z.ZodTypeAny>(schema: T) {
  return z.object({ ok: z.literal(true), data: schema });
}

export function err() {
  return z.object({
    ok: z.literal(false),
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  });
}

// ─── AI slot config ────────────────────────────────────────────────────────

export const AiSlotConfigSchema = z.object({
  slot: z.string(),
  provider: z.enum(["gemini", "grok"]),
  model_id: z.string(),
  credential_slot: z.number().int().min(1).max(4),
  enabled: z.boolean().default(true),
  max_concurrency: z.number().int().min(1).default(2),
  request_budget_per_minute: z.number().int().min(1).default(30),
  timeout_ms: z.number().int().min(1000).default(60_000),
  retry: z
    .object({
      max_attempts: z.number().int().min(0).default(3),
      base_delay_ms: z.number().int().min(0).default(1000),
      max_delay_ms: z.number().int().min(0).default(30_000),
    })
    .default({}),
});

// ─── Campaign settings ────────────────────────────────────────────────────

export const CampaignSettingsSchema = z.object({
  writing: z.object({
    purpose: z.string(),
    sender_description: z.string(),
    audience: z.string(),
    tone: z.string().default("professional"),
    formality: z.enum(["casual", "professional", "formal"]).default("professional"),
    desired_length: z.enum(["short", "medium", "long"]).default("medium"),
    required_sections: z.array(z.string()).default([]),
    call_to_action: z.string().default(""),
    prohibited_phrases: z.array(z.string()).default([]),
    custom_instructions: z.string().default(""),
    humanization_intensity: z.enum(["light", "standard", "strong"]).default("standard"),
  }),
  approval: z.object({
    mode: z.enum(["manual", "auto"]).default("manual"),
    required_reviewers: z.array(z.string()).default([]),
    min_score: z.number().min(0).max(100).default(70),
    auto_send: z.boolean().default(false),
  }),
  delivery: z.object({
    sending_mode: z.enum(["draft", "direct"]).default("draft"),
    max_per_hour: z.number().int().min(1).default(60),
    max_per_day: z.number().int().min(1).default(500),
    permitted_hours: z
      .object({ start: z.number().min(0).max(23), end: z.number().min(0).max(23) })
      .default({ start: 9, end: 18 }),
    suppression_list: z.array(z.string().email()).default([]),
  }),
  revision: z.object({
    max_cycles: z.number().int().min(0).max(10).default(3),
  }),
});

export type CampaignSettings = z.infer<typeof CampaignSettingsSchema>;
export type AiSlotConfig = z.infer<typeof AiSlotConfigSchema>;
export type Contact = z.infer<typeof ContactSchema>;
export type ImportRow = z.infer<typeof ImportRowSchema>;
export type EmailVersion = z.infer<typeof EmailVersionSchema>;
export type AiReview = z.infer<typeof AiReviewSchema>;
export type WorkflowEvent = z.infer<typeof WorkflowEventSchema>;
export type SendOperation = z.infer<typeof SendOperationSchema>;
export type ReviewIssue = z.infer<typeof ReviewIssueSchema>;
