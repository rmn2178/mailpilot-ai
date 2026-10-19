"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface DeliveryActionsProps {
  initialStopped: boolean;
}

/**
 * Client-side delivery switch buttons. Per bug #6: the previous version used
 * <form method="POST"> which caused the browser to display raw JSON.
 */
export function DeliveryActions({ initialStopped }: DeliveryActionsProps) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [stopped, setStopped] = useState(initialStopped);
  const router = useRouter();

  async function postAction(action: "stop" | "enable") {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/settings/delivery", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `action=${action}`,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? `${action} failed`);
      }
      setStopped(action === "stop");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        className={stopped ? "btn-primary" : "btn"}
        onClick={() => postAction(stopped ? "enable" : "stop")}
        disabled={busy}
      >
        {busy ? "…" : stopped ? "Enable sending" : "Stop all sending"}
      </button>
      {err && <div className="text-sm text-danger">{err}</div>}
    </div>
  );
}
