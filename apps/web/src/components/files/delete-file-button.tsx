"use client";

import { useState } from "react";

interface DeleteFileButtonProps {
  campaignId: string;
  fileId: string;
  filename?: string;
}

/**
 * Delete a campaign reference file via DELETE /api/campaigns/[campaignId]/files?id=…
 *
 * Per §6 (4th-pass): the previous version used a <form method="POST"> but the
 * route only implements DELETE. Browsers cannot send DELETE via form submit,
 * so the request was 405'd. This client component uses fetch with method: DELETE.
 */
export function DeleteFileButton({ campaignId, fileId, filename }: DeleteFileButtonProps) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onDelete() {
    if (!confirm(`Delete ${filename ?? "this file"}? Reference files used by AI will need to be re-uploaded.`)) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/campaigns/${campaignId}/files?id=${encodeURIComponent(fileId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? "Delete failed");
      }
      // Reload the page to refresh the file list.
      window.location.reload();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <span className="space-y-1">
      <button
        type="button"
        className="text-xs text-danger hover:underline disabled:opacity-50"
        onClick={onDelete}
        disabled={busy}
      >
        {busy ? "deleting…" : "remove"}
      </button>
      {err && <div className="text-xs text-danger">{err}</div>}
    </span>
  );
}
