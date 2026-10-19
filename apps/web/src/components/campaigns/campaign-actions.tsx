"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface CampaignActionsProps {
  campaignId: string;
  initialStatus: string;
}

/**
 * Client-side Start / Pause / Resume buttons for a campaign.
 *
 * Per §11 (4th-pass): the previous version used <form method="POST"> which
 * caused the browser to display raw JSON. This client component uses fetch
 * and router.refresh() to update the page in place.
 */
export function CampaignActions({ campaignId, initialStatus }: CampaignActionsProps) {
  const [busy, setBusy] = useState<null | "start" | "pause">(null);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  async function postAction(action: "start" | "pause") {
    setBusy(action);
    setErr(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/${action}`, { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? `${action} failed`);
      }
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {initialStatus !== "active" && (
        <button className="btn-primary" onClick={() => postAction("start")} disabled={busy !== null}>
          {busy === "start" ? "Starting…" : "Start"}
        </button>
      )}
      {initialStatus === "active" && (
        <button className="btn" onClick={() => postAction("pause")} disabled={busy !== null}>
          {busy === "pause" ? "Pausing…" : "Pause"}
        </button>
      )}
      {err && <span className="text-xs text-danger">{err}</span>}
    </div>
  );
}
