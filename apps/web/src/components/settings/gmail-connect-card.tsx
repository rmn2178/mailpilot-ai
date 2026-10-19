"use client";

import { useEffect, useState } from "react";
import { formatDate } from "@/lib/utils";

export function GmailConnectCard({
  account: initial,
}: {
  account: { email: string; connected_at: string } | null;
}) {
  const [account, setAccount] = useState(initial);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (account) return;
    // Poll for connection completion after OAuth redirect
    const id = setInterval(async () => {
      const r = await fetch("/api/connections/gmail/status");
      const j = await r.json();
      if (j?.data?.email) {
        setAccount({ email: j.data.email, connected_at: j.data.connected_at });
        clearInterval(id);
      }
    }, 3000);
    return () => clearInterval(id);
  }, [account]);

  async function connect() {
    setBusy(true);
    const r = await fetch("/api/connections/gmail/connect", { method: "POST" });
    const j = await r.json();
    if (j?.data?.url) {
      window.location.href = j.data.url;
    } else {
      setBusy(false);
    }
  }

  if (account) {
    return (
      <div className="panel panel-pad space-y-2">
        <div className="flex items-center gap-2">
          <span className="pill-success">connected</span>
          <span className="font-medium">{account.email}</span>
        </div>
        <div className="text-xs text-ink-muted">
          Connected {formatDate(account.connected_at)}
        </div>
      </div>
    );
  }

  return (
    <div className="panel panel-pad space-y-3">
      <p className="text-sm">
        Connect a Gmail account. We request only the scopes required to send
        mail and create drafts — nothing else.
      </p>
      <button className="btn-primary" onClick={connect} disabled={busy}>
        {busy ? "Redirecting…" : "Connect Gmail"}
      </button>
    </div>
  );
}
