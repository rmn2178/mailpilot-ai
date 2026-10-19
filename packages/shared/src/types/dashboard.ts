export interface DashboardMetrics {
  totals: {
    recipients_imported: number;
    emails_processing: number;
    waiting_for_approval: number;
    approved_ready_to_send: number;
    sent: number;
    failed_or_needs_attention: number;
  };
  queue: {
    backlog: number;
    active: number;
    delayed: number;
    failed: number;
  };
  worker: {
    online: boolean;
    last_heartbeat_at: string | null;
    queue_depth: number;
  };
  providers: Array<{
    slot: string;
    provider: "gemini" | "grok";
    available: boolean;
    last_error: string | null;
  }>;
  recent_activity: Array<{
    id: string;
    stage: string;
    event_type: string;
    created_at: string;
    summary: string;
  }>;
}

export interface PipelineStageStatus {
  stage:
    | "import"
    | "analysis"
    | "draft"
    | "humanization"
    | "grok_reviews"
    | "gemini_qa"
    | "quality_gate"
    | "approval"
    | "delivery";
  status:
    | "pending"
    | "running"
    | "passed"
    | "failed"
    | "blocked"
    | "retrying";
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  assigned_slot: string | null;
  attempt: number | null;
  score: number | null;
  explanation: string | null;
  issues: Array<{ severity: string; code: string; message: string }>;
}
