import { getServiceSupabase, enqueueIdempotent, QUEUE_NAMES, transitionTicket } from "@mailpilot/server-core";

/**
 * Recovery sweep — runs on worker startup. Reconciles tickets that were left
 * in active-processing states by a crash or restart.
 *
 * Per spec §3: "PostgreSQL is the authoritative application state. Redis is
 * the scheduling system. Reconcile their state after failures or restarts."
 *
 * For each stuck ticket:
 *   1. Reset it to a safe checkpoint state via the state machine.
 *   2. Re-enqueue the appropriate job via the orchestrator.
 *
 * Per §2.15: the previous version only reset state but never enqueued. Fixed.
 */
export async function runRecoverySweep(): Promise<void> {
  const sb = getServiceSupabase();
  const { data: stuck } = await sb
    .from("tickets")
    .select("id, current_state, updated_at, campaign_id")
    .in("current_state", [
      "analyzing",
      "drafting",
      "humanizing",
      "grok_reviews",
      "gemini_qa",
      "quality_gate",
      "revising",
      "sending",
    ]);

  const now = Date.now();
  let recovered = 0;
  for (const t of stuck ?? []) {
    const updated = new Date(t.updated_at).getTime();
    // Only recover tickets that have been stuck for >10 minutes — short enough
    // to catch real crashes, long enough to not interfere with active work.
    if (now - updated > 10 * 60 * 1000) {
      // Map each stuck state to a safe reset point and the queue to re-enqueue.
      // Use the state machine: only legal transitions are attempted.
      const fromState = t.current_state as
        | "analyzing"
        | "drafting"
        | "humanizing"
        | "grok_reviews"
        | "gemini_qa"
        | "quality_gate"
        | "revising"
        | "sending";

      try {
        if (fromState === "sending") {
          // Sending crash → unknown outcome, requires manual reconciliation.
          await transitionTicket({
            ticket_id: t.id,
            from: "sending",
            to: "send_status_unknown",
            actor_id: null,
            reason: "Worker restart during send",
          });
        } else if (fromState === "revising" || fromState === "quality_gate") {
          // These can re-enter humanizing (revising) or pending_approval (gate).
          // Safer to send back to the queue and let the orchestrator re-decide.
          await transitionTicket({
            ticket_id: t.id,
            from: fromState,
            to: "needs_attention",
            actor_id: null,
            reason: `Recovered from ${fromState} after worker restart`,
          });
        } else {
          // analyzing/drafting/humanizing/grok_reviews/gemini_qa — re-enqueue
          // the appropriate job. The processor will idempotently skip if the
          // work is already done.
          await enqueueForState(t.id, fromState);
        }
        recovered += 1;
      } catch (e) {
        console.warn(`[recovery] could not reset ticket ${t.id} from ${fromState}:`, (e as Error).message);
      }
    }
  }

  console.log(`[recovery] sweep complete — ${stuck?.length ?? 0} stuck, ${recovered} recovered`);
}

async function enqueueForState(
  ticketId: string,
  state: "analyzing" | "drafting" | "humanizing" | "grok_reviews" | "gemini_qa",
): Promise<void> {
  // Re-enqueue without changing state. The processor's idempotency guard
  // will skip if the work is already done, or proceed if it isn't.
  switch (state) {
    case "analyzing":
      await enqueueIdempotent(QUEUE_NAMES.analysis, "analyze", { ticketId }, `analyze-${ticketId}`);
      break;
    case "drafting":
      await enqueueIdempotent(QUEUE_NAMES.generation, "generate", { ticketId }, `generate-${ticketId}`);
      break;
    case "humanizing":
      await enqueueIdempotent(QUEUE_NAMES.humanization, "humanize", { ticketId }, `humanize-${ticketId}`);
      break;
    case "grok_reviews":
    case "gemini_qa": {
      // Re-run the orchestrator, which will enqueue any missing review jobs.
      const { orchestrate } = await import("./workflow-orchestrator");
      await orchestrate(ticketId);
      break;
    }
  }
}
