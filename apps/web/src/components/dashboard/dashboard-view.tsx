"use client";

import { formatDate } from "@/lib/utils";
import Link from "next/link";

interface DashboardViewProps {
  counts: {
    recipients_imported: number;
    emails_processing: number;
    waiting_for_approval: number;
    approved_ready_to_send: number;
    sent: number;
    failed_or_needs_attention: number;
  };
  recentEvents: Array<{
    id: string;
    stage: string;
    event_type: string;
    created_at: string;
    metadata: Record<string, unknown>;
    error: string | null;
    ticket_id: string | null;
  }>;
  worker: {
    last_beat_at: string | null;
    online: boolean;
    queue_depth?: number;
  };
  providers: Array<{
    slot: string;
    provider: "gemini" | "grok";
    enabled: boolean;
    cooldown_until: string | null;
    last_error: string | null;
  }>;
  queueBacklog: number;
}

const cards: Array<{
  key: keyof DashboardViewProps["counts"];
  label: string;
  tone: "default" | "info" | "warn" | "danger" | "success";
}> = [
  { key: "recipients_imported", label: "Recipients imported", tone: "default" },
  { key: "emails_processing", label: "Emails processing", tone: "info" },
  { key: "waiting_for_approval", label: "Waiting for approval", tone: "warn" },
  { key: "approved_ready_to_send", label: "Approved / ready", tone: "success" },
  { key: "sent", label: "Sent", tone: "success" },
  { key: "failed_or_needs_attention", label: "Needs attention", tone: "danger" },
];

export function DashboardView({
  counts,
  recentEvents,
  worker,
  providers,
  queueBacklog,
}: DashboardViewProps) {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-ink-muted">
            Live counts from persisted state. No simulated progress.
          </p>
        </div>
        <Link href="/campaigns/new" className="btn-primary">
          New campaign
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {cards.map((c) => (
          <div key={c.key} className="panel panel-pad">
            <div className="text-xs text-ink-muted">{c.label}</div>
            <div className="text-2xl font-semibold mt-1">{counts[c.key] ?? 0}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="panel panel-pad lg:col-span-2">
          <h2 className="font-semibold mb-3">Recent activity</h2>
          <ul className="divide-y divide-line">
            {recentEvents.length === 0 && (
              <li className="text-sm text-ink-muted py-3">
                No activity yet.
              </li>
            )}
            {recentEvents.map((e) => (
              <li key={e.id} className="py-2 text-sm flex items-start gap-3">
                <span className="pill-info">{e.stage}</span>
                <div className="flex-1">
                  <div className="text-ink">{e.event_type}</div>
                  {e.error && (
                    <div className="text-xs text-danger mt-0.5">{e.error}</div>
                  )}
                  <div className="text-xs text-ink-muted mt-0.5">
                    {formatDate(e.created_at)}
                    {e.ticket_id && (
                      <>
                        {" · "}
                        <Link
                          href={`/tickets/${e.ticket_id}`}
                          className="text-brand hover:underline"
                        >
                          ticket
                        </Link>
                      </>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="panel panel-pad space-y-3">
          <div>
            <h2 className="font-semibold">Worker</h2>
            <div className="flex items-center gap-2 text-sm mt-1">
              <span
                className={`w-2 h-2 rounded-full ${
                  worker.online ? "bg-success" : "bg-danger"
                }`}
              />
              {worker.online ? "Online" : "Offline"}
            </div>
            <div className="text-xs text-ink-muted mt-1">
              Last heartbeat: {formatDate(worker.last_beat_at)}
            </div>
            <div className="text-xs text-ink-muted">
              Queue backlog: {worker.queue_depth ?? queueBacklog}
            </div>
          </div>
          <div>
            <h3 className="font-semibold text-sm mb-2">Provider availability</h3>
            <ul className="space-y-1 text-xs">
              {providers.map((p) => (
                <li key={p.slot} className="flex items-center justify-between gap-2">
                  <span className="font-mono">{p.slot}</span>
                  <span
                    className={
                      !p.enabled
                        ? "text-ink-muted"
                        : p.cooldown_until
                          ? "text-warn"
                          : "text-success"
                    }
                  >
                    {!p.enabled
                      ? "disabled"
                      : p.cooldown_until
                        ? "cooldown"
                        : "available"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
