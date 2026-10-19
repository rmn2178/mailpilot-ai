import { getServiceSupabase, recordWorkflowEvent } from "@mailpilot/server-core";

/** Convenience wrapper that records a workflow event for a ticket. */
export async function emitEvent(input: {
  ticket_id: string;
  campaign_id: string;
  stage: string;
  event_type: string;
  metadata?: Record<string, unknown>;
  error?: string | null;
}): Promise<void> {
  await recordWorkflowEvent(input);
  void getServiceSupabase;
}
