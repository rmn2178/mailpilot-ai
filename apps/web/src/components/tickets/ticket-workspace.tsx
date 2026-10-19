"use client";

import { useState } from "react";
import { formatDate, formatDuration } from "@/lib/utils";
import Link from "next/link";
import { ALLOWED_REVISION_SOURCES, REJECTABLE_SOURCES } from "@mailpilot/shared";

interface TicketWorkspaceProps {
  ticket: {
    id: string;
    campaign_id: string;
    recipient_email: string;
    current_state: string;
    current_email_version_id: string | null;
    approval_status: string;
    revision_attempts: number;
    last_error: string | null;
    created_at: string;
    updated_at: string;
  };
  campaignName: string;
  contact: {
    email: string;
    first_name: string | null;
    last_name: string | null;
    company: string | null;
    job_title: string | null;
    custom_fields: Record<string, unknown> | null;
  } | null;
  versions: Array<{
    id: string;
    version_number: number;
    subject: string;
    body_plain: string;
    body_html: string | null;
    source_references: unknown[];
    created_by: string;
    created_at: string;
  }>;
  reviews: Array<{
    id: string;
    reviewer_role: string;
    provider: string;
    model_id: string;
    status: string;
    score: number | null;
    decision: string;
    issues: unknown[];
    summary: string;
    duration_ms: number | null;
    started_at: string;
    email_version_id: string;
  }>;
  events: Array<{
    id: string;
    stage: string;
    event_type: string;
    metadata: Record<string, unknown>;
    error: string | null;
    created_at: string;
  }>;
  attachments: Array<{
    id: string;
    filename: string;
    mime: string;
    size_bytes: number;
  }>;
}

const STAGES = [
  "queued",
  "analyzing",
  "drafting",
  "humanizing",
  "grok_reviews",
  "gemini_qa",
  "quality_gate",
  "pending_approval",
  "approved",
  "ready_to_send",
  "sending",
  "sent",
] as const;

// Per bug #2: approved/ready_to_send/gmail_draft_created cannot be edited.
// Mirrors the EDITABLE_STATES set in PATCH /api/tickets/[ticketId].
const EDITABLE_STATES = new Set([
  "queued", "analyzing", "drafting", "humanizing", "grok_reviews",
  "gemini_qa", "quality_gate", "revising", "pending_approval",
  "needs_attention",
]);

// Per §8 (5th-pass): off-path states that should display a red attention pill
// in the pipeline strip instead of falling back to stage 0 ("queued").
const ATTENTION_STATES = new Set([
  "needs_attention", "blocked", "failed", "send_status_unknown", "cancelled", "paused", "retry_scheduled",
]);

function stateToStage(s: string): number {
  const idx = STAGES.indexOf(s as (typeof STAGES)[number]);
  return idx === -1 ? 0 : idx;
}

export function TicketWorkspace({
  ticket,
  campaignName,
  contact,
  versions,
  reviews,
  events,
  attachments,
}: TicketWorkspaceProps) {
  const currentStage = stateToStage(ticket.current_state);
  const currentVersion = versions.find((v) => v.id === ticket.current_email_version_id) ?? versions[0];
  const [subject, setSubject] = useState(currentVersion?.subject ?? "");
  const [body, setBody] = useState(currentVersion?.body_plain ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function saveDraft() {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/tickets/${ticket.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject, body_plain: body }),
    });
    setBusy(false);
    if (res.ok) {
      setMsg("Saved — ticket moved to needs attention; click 'Request revision' to re-run reviews");
      // Reload to reflect the new state.
      window.location.reload();
    } else {
      const j = await res.json().catch(() => ({}));
      setMsg(j?.error?.message ?? "Save failed");
    }
  }

  async function approve() {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/tickets/${ticket.id}/approve`, { method: "POST" });
    setBusy(false);
    setMsg(res.ok ? "Approved" : "Approval failed");
  }
  async function reject() {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/tickets/${ticket.id}/reject`, { method: "POST" });
    setBusy(false);
    setMsg(res.ok ? "Rejected" : "Reject failed");
  }
  async function requestRevision() {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/tickets/${ticket.id}/revision`, { method: "POST" });
    setBusy(false);
    setMsg(res.ok ? "Revision requested" : "Failed");
  }
  async function sendDirect() {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/gmail/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket_id: ticket.id }),
    });
    setBusy(false);
    setMsg(res.ok ? "Send queued" : "Send failed");
  }
  async function createGmailDraft() {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/gmail/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket_id: ticket.id }),
    });
    setBusy(false);
    setMsg(res.ok ? "Draft created in Gmail" : "Draft creation failed");
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-line flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-xs text-ink-muted">
            <Link href={`/campaigns/${ticket.campaign_id}`} className="hover:underline">
              {campaignName}
            </Link>{" "}
            › Ticket
          </div>
          <h1 className="font-semibold truncate">{ticket.recipient_email}</h1>
        </div>
        <span className="pill-info capitalize">{ticket.current_state.replace(/_/g, " ")}</span>
      </div>

      {/* Pipeline strip */}
      <div className="px-6 py-3 border-b border-line overflow-x-auto">
        <div className="flex items-center gap-2 text-xs flex-wrap">
          {STAGES.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <span
                className={
                  i < currentStage
                    ? "text-success"
                    : i === currentStage
                      ? "text-brand font-medium"
                      : "text-ink-muted"
                }
              >
                {s.replace(/_/g, " ")}
              </span>
              {i < STAGES.length - 1 && <span className="text-line">→</span>}
            </div>
          ))}
          {/* Per §8 (5th-pass): attention / blocked / failed / draft-created
              states are not in the linear STAGES array. Show a red pill so the
              user immediately sees the ticket is off the happy path instead of
              stage 0 ("queued") which looked like a fresh ticket. */}
          {ATTENTION_STATES.has(ticket.current_state) && (
            <span className="pill-danger ml-2">
              {ticket.current_state.replace(/_/g, " ")}
            </span>
          )}
          {ticket.current_state === "gmail_draft_created" && !ATTENTION_STATES.has(ticket.current_state) && (
            <span className="pill-info ml-2">draft in Gmail</span>
          )}
        </div>
      </div>

      <div className="flex-1 grid grid-cols-12 gap-4 p-6 overflow-hidden">
        {/* Left — context */}
        <div className="col-span-3 panel panel-pad overflow-auto space-y-4">
          <div>
            <h3 className="font-semibold text-sm mb-1">Recipient</h3>
            <dl className="text-sm space-y-1">
              <div><dt className="text-ink-muted text-xs">Name</dt><dd>{[contact?.first_name, contact?.last_name].filter(Boolean).join(" ") || "—"}</dd></div>
              <div><dt className="text-ink-muted text-xs">Email</dt><dd>{ticket.recipient_email}</dd></div>
              <div><dt className="text-ink-muted text-xs">Company</dt><dd>{contact?.company ?? "—"}</dd></div>
              <div><dt className="text-ink-muted text-xs">Title</dt><dd>{contact?.job_title ?? "—"}</dd></div>
            </dl>
          </div>
          <div>
            <h3 className="font-semibold text-sm mb-1">Attachments</h3>
            {attachments.length === 0 ? (
              <p className="text-xs text-ink-muted">No outgoing attachments.</p>
            ) : (
              <ul className="text-xs space-y-1">
                {attachments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between">
                    <span className="truncate">{a.filename}</span>
                    <span className="text-ink-muted">{Math.round(a.size_bytes / 1024)}KB</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="font-semibold text-sm mb-1">Recent events</h3>
            <ul className="text-xs space-y-1">
              {events.slice(0, 8).map((e) => (
                <li key={e.id} className="border-l-2 border-line pl-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-ink">{e.stage}</span>
                    <span className="text-ink-muted">{formatDate(e.created_at)}</span>
                  </div>
                  {e.error && <div className="text-danger">{e.error}</div>}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Center — editor */}
        <div className="col-span-6 panel panel-pad overflow-auto space-y-3">
          <div>
            <label className="label">Subject</label>
            <input className="input mt-1" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div>
            <label className="label">Body</label>
            <textarea className="input mt-1 min-h-[280px] font-mono text-xs" value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          {ticket.last_error && (
            <div className="text-sm text-danger bg-danger-subtle border border-danger/30 rounded-md px-3 py-2">
              {ticket.last_error}
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Save is enabled only when (a) the ticket is in an editable state
                AND (b) subject/body have changed from the current version. */}
            <button
              className="btn"
              onClick={saveDraft}
              disabled={busy || !EDITABLE_STATES.has(ticket.current_state) || (subject === (currentVersion?.subject ?? "") && body === (currentVersion?.body_plain ?? ""))}
              title={!EDITABLE_STATES.has(ticket.current_state)
                ? `Cannot edit ticket in state ${ticket.current_state}`
                : "Save a new human-edited version. The ticket moves to needs_attention and reviews are invalidated; click 'Request revision' to re-run them."}
            >
              Save draft
            </button>
            {/* Approve / Reject only make sense when the ticket is awaiting a decision. */}
            <button
              className="btn-primary"
              onClick={approve}
              disabled={busy || ticket.current_state !== "pending_approval"}
              title={ticket.current_state !== "pending_approval" ? `Cannot approve from state ${ticket.current_state}` : "Approve this version"}
            >
              Approve
            </button>
            <button
              className="btn"
              onClick={reject}
              disabled={busy || !REJECTABLE_SOURCES.includes(ticket.current_state)}
              title={!REJECTABLE_SOURCES.includes(ticket.current_state) ? `Cannot reject from state ${ticket.current_state}` : "Cancel this ticket"}
            >
              Reject
            </button>
            <button
              className="btn"
              onClick={requestRevision}
              disabled={busy || !ALLOWED_REVISION_SOURCES.includes(ticket.current_state)}
              title={!ALLOWED_REVISION_SOURCES.includes(ticket.current_state)
                ? `Cannot request revision from state ${ticket.current_state}. Allowed: ${ALLOWED_REVISION_SOURCES.join(", ")}`
                : "Re-run the review pipeline (analyzes, redrafts, re-reviews)"}
            >
              Request revision
            </button>
            <div className="flex-1" />
            {/* Open in Gmail (draft) and Send email require approval. */}
            <button
              className="btn"
              onClick={createGmailDraft}
              disabled={busy || !["approved", "ready_to_send", "gmail_draft_created"].includes(ticket.current_state)}
              title={!["approved", "ready_to_send", "gmail_draft_created"].includes(ticket.current_state) ? "Ticket must be approved first" : "Create a Gmail draft"}
            >
              Open in Gmail
            </button>
            <button
              className="btn-primary"
              onClick={sendDirect}
              disabled={busy || !["approved", "ready_to_send", "gmail_draft_created"].includes(ticket.current_state)}
              title={!["approved", "ready_to_send", "gmail_draft_created"].includes(ticket.current_state) ? "Ticket must be approved first" : "Send via Gmail"}
            >
              Send email
            </button>
          </div>
          {msg && <div className="text-sm text-ink-muted">{msg}</div>}
          <details className="text-xs text-ink-muted">
            <summary className="cursor-pointer">All versions ({versions.length})</summary>
            <ul className="mt-2 space-y-2">
              {versions.map((v) => (
                <li key={v.id} className="border-l-2 border-line pl-2">
                  <div className="font-medium">v{v.version_number} · {v.subject}</div>
                  <div className="text-ink-muted">{v.created_by} · {formatDate(v.created_at)}</div>
                </li>
              ))}
            </ul>
          </details>
        </div>

        {/* Right — AI pipeline */}
        <div className="col-span-3 panel panel-pad overflow-auto space-y-3">
          <h3 className="font-semibold text-sm">AI pipeline</h3>
          {[
            "gemini_analyze",
            "gemini_generate",
            "humanizer",
            "grok_defensibility",
            "grok_human_tone",
            "grok_content_fit",
            "grok_delivery_hygiene",
            "gemini_qa_structure",
            "gemini_qa_personalization",
          ].map((role) => {
            const r = reviews.find((x) => x.reviewer_role === role);
            return (
              <div key={role} className="border border-line rounded-md p-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-mono">{role}</span>
                  {r ? (
                    <span className={
                      r.decision === "pass" ? "pill-success" :
                      r.decision === "revise" ? "pill-warn" :
                      r.decision === "blocked" || r.decision === "error" ? "pill-danger" : "pill-info"
                    }>
                      {r.decision}
                    </span>
                  ) : (
                    <span className="text-ink-muted">pending</span>
                  )}
                </div>
                {r && (
                  <div className="mt-1 text-ink-muted">
                    {r.score != null && <>score {r.score} · </>}
                    {formatDuration(r.duration_ms)}
                    <div className="mt-1 line-clamp-2">{r.summary}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
