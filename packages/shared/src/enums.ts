/**
 * MailPilot AI — shared enumerations.
 *
 * These are string-union backed constants used across the web app, the worker
 * and server-core. They MUST stay in sync with the database CHECK constraints
 * declared in supabase/migrations/0001_core.sql.
 */

export const CampaignStatus = {
  DRAFT: "draft",
  ACTIVE: "active",
  PAUSED: "paused",
  COMPLETED: "completed",
  ARCHIVED: "archived",
} as const;
export type CampaignStatus = (typeof CampaignStatus)[keyof typeof CampaignStatus];

export const ImportStatus = {
  UPLOADED: "uploaded",
  VALIDATING: "import_validating",
  PREVIEW: "import_preview",
  CONFIRMED: "import_confirmed",
  PROCESSING: "import_processing",
  COMPLETED: "import_completed",
  FAILED: "import_failed",
  CANCELLED: "import_cancelled",
} as const;
export type ImportStatus = (typeof ImportStatus)[keyof typeof ImportStatus];

export const TicketState = {
  QUEUED: "queued",
  ANALYZING: "analyzing",
  DRAFTING: "drafting",
  HUMANIZING: "humanizing",
  GROK_REVIEWS: "grok_reviews",
  GEMINI_QA: "gemini_qa",
  QUALITY_GATE: "quality_gate",
  REVISING: "revising",
  PENDING_APPROVAL: "pending_approval",
  APPROVED: "approved",
  READY_TO_SEND: "ready_to_send",
  GMAIL_DRAFT_CREATED: "gmail_draft_created",
  SENDING: "sending",
  SENT: "sent",
  SEND_STATUS_UNKNOWN: "send_status_unknown",
  NEEDS_ATTENTION: "needs_attention",
  PAUSED: "paused",
  BLOCKED: "blocked",
  RETRY_SCHEDULED: "retry_scheduled",
  FAILED: "failed",
  CANCELLED: "cancelled",
} as const;
export type TicketState = (typeof TicketState)[keyof typeof TicketState];

export const ApprovalStatus = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  REVISION_REQUESTED: "revision_requested",
  AUTO_APPROVED: "auto_approved",
} as const;
export type ApprovalStatus = (typeof ApprovalStatus)[keyof typeof ApprovalStatus];

export const ReviewerRole = {
  GEMINI_ANALYZE: "gemini_analyze",
  GEMINI_GENERATE: "gemini_generate",
  GEMINI_QA_STRUCTURE: "gemini_qa_structure",
  GEMINI_QA_PERSONALIZATION: "gemini_qa_personalization",
  GROK_DEFENSIBILITY: "grok_defensibility",
  GROK_HUMAN_TONE: "grok_human_tone",
  GROK_CONTENT_FIT: "grok_content_fit",
  GROK_DELIVERY_HYGIENE: "grok_delivery_hygiene",
  HUMANIZER: "humanizer",
} as const;
export type ReviewerRole = (typeof ReviewerRole)[keyof typeof ReviewerRole];

export const ReviewDecision = {
  PASS: "pass",
  REVISE: "revise",
  BLOCKED: "blocked",
  ERROR: "error",
} as const;
export type ReviewDecision = (typeof ReviewDecision)[keyof typeof ReviewDecision];

export const ProviderType = {
  GEMINI: "gemini",
  GROK: "grok",
} as const;
export type ProviderType = (typeof ProviderType)[keyof typeof ProviderType];

export const SendMode = {
  DRAFT: "draft",
  DIRECT: "direct",
} as const;
export type SendMode = (typeof SendMode)[keyof typeof SendMode];

export const SendOperationStatus = {
  QUEUED: "queued",
  SENDING: "sending",
  SENT: "sent",
  FAILED: "failed",
  UNKNOWN: "unknown",
  RECONCILING: "reconciling",
} as const;
export type SendOperationStatus =
  (typeof SendOperationStatus)[keyof typeof SendOperationStatus];

export const FilePurpose = {
  CAMPAIGN_REFERENCE: "campaign_reference",
  TICKET_SUPPORTING: "ticket_supporting",
  EMAIL_ATTACHMENT: "email_attachment",
} as const;
export type FilePurpose = (typeof FilePurpose)[keyof typeof FilePurpose];

export const GlobalSendSwitch = {
  ENABLED: "enabled",
  STOPPED: "stopped",
} as const;
export type GlobalSendSwitch = (typeof GlobalSendSwitch)[keyof typeof GlobalSendSwitch];

/**
 * The eight configurable AI slots described in §4 of the implementation prompt.
 */
export const AI_SLOTS = [
  "gemini_analyze",
  "gemini_generate",
  "gemini_qa_structure",
  "gemini_qa_personalization",
  "grok_defensibility",
  "grok_human_tone",
  "grok_content_fit",
  "grok_delivery_hygiene",
] as const;
export type AiSlot = (typeof AI_SLOTS)[number];

export const PIPELINE_STAGES = [
  "import",
  "analysis",
  "draft",
  "humanization",
  "grok_reviews",
  "gemini_qa",
  "quality_gate",
  "approval",
  "delivery",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];
