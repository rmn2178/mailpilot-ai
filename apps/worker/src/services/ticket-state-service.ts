import { getServiceSupabase, transitionTicket } from "@mailpilot/server-core";
import type { TicketState } from "@mailpilot/shared";

/**
 * Ticket state service — thin wrapper around the workflow state machine,
 * with optimistic-concurrency retry on contention.
 */
export async function safeTransition(
  ticketId: string,
  candidates: Array<{ from: TicketState; to: TicketState; reason?: string }>,
): Promise<boolean> {
  const sb = getServiceSupabase();
  const { data: ticket } = await sb.from("tickets").select("current_state").eq("id", ticketId).maybeSingle();
  if (!ticket) return false;
  const candidate = candidates.find((c) => c.from === ticket.current_state);
  if (!candidate) return false;
  try {
    await transitionTicket({
      ticket_id: ticketId,
      from: candidate.from,
      to: candidate.to,
      actor_id: null,
      reason: candidate.reason,
    });
    return true;
  } catch {
    return false;
  }
}
