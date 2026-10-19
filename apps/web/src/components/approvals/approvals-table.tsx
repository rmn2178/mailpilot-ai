"use client";

import Link from "next/link";
import { useState } from "react";

interface ApprovalsTableProps {
  tickets: Array<{
    id: string;
    recipient_email: string;
    approval_status: string;
    updated_at: string;
    campaigns: { id: string; name: string } | null;
    current_email_version_id: string | null;
  }>;
  versions: Array<{ id: string; subject: string; version_number: number }>;
  reviews: Array<{
    ticket_id: string;
    reviewer_role: string;
    decision: string;
    score: number | null;
  }>;
}

export function ApprovalsTable({ tickets, versions, reviews }: ApprovalsTableProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulkApprove() {
    if (selected.size === 0) return;
    const res = await fetch("/api/approvals/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket_ids: [...selected], action: "approve" }),
    });
    if (res.ok) {
      alert(`Bulk approve: ${(await res.json()).data?.approved?.length ?? 0} approved`);
      setSelected(new Set());
    } else {
      alert("Bulk approve failed — some tickets may be blocked.");
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
          <p className="text-sm text-ink-muted">
            Bulk approve runs every selected ticket through its full set of mandatory
            checks individually. Blocked tickets are never approved.
          </p>
        </div>
        <button
          className="btn-primary"
          onClick={bulkApprove}
          disabled={selected.size === 0}
        >
          Approve {selected.size > 0 ? `(${selected.size})` : ""}
        </button>
      </div>
      <div className="panel">
        <table className="w-full text-sm">
          <thead className="text-ink-muted text-xs uppercase">
            <tr className="border-b border-line">
              <th className="px-4 py-2 w-8">
                <input
                  type="checkbox"
                  onChange={(e) =>
                    setSelected(e.target.checked ? new Set(tickets.map((t) => t.id)) : new Set())
                  }
                  checked={selected.size === tickets.length && tickets.length > 0}
                />
              </th>
              <th className="text-left font-medium px-4 py-2">Recipient</th>
              <th className="text-left font-medium px-4 py-2">Subject</th>
              <th className="text-left font-medium px-4 py-2">Reviews</th>
              <th className="text-left font-medium px-4 py-2">Updated</th>
            </tr>
          </thead>
          <tbody>
            {tickets.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink-muted">
                  Nothing waiting for approval.
                </td>
              </tr>
            ) : (
              tickets.map((t) => {
                const v = versions.find((x) => x.id === t.current_email_version_id);
                const ticketReviews = reviews.filter((r) => r.ticket_id === t.id);
                const allPass = ticketReviews.length > 0 && ticketReviews.every((r) => r.decision === "pass");
                return (
                  <tr key={t.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(t.id)}
                        onChange={() => toggle(t.id)}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <Link href={`/tickets/${t.id}`} className="text-ink hover:text-brand">
                        {t.recipient_email}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{v?.subject ?? "—"}</td>
                    <td className="px-4 py-2">
                      <span className={allPass ? "pill-success" : "pill-warn"}>
                        {ticketReviews.length} reviews
                      </span>
                    </td>
                    <td className="px-4 py-2 text-ink-muted">
                      {new Date(t.updated_at).toLocaleString()}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
