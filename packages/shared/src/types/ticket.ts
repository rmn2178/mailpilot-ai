import type { TicketState, ApprovalStatus } from "../enums";

export interface Ticket {
  id: string;
  campaign_id: string;
  contact_id: string;
  recipient_email: string;
  current_state: TicketState;
  current_email_version_id: string | null;
  approval_status: ApprovalStatus;
  revision_attempts: number;
  next_scheduled_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailVersion {
  id: string;
  ticket_id: string;
  version_number: number;
  subject: string;
  body_plain: string;
  body_html: string | null;
  source_references: unknown[];
  attachment_manifest: string[];
  created_by: "ai" | "human" | "system";
  created_at: string;
}
