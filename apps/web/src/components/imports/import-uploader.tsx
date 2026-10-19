"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ImportUploader({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onUpload() {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("campaign_id", campaignId);
      const res = await fetch("/api/imports", { method: "POST", body: form });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? "Upload failed");
      }
      const j = (await res.json()) as { data: { id: string } };
      // Navigate to the import detail page where the user can preview rows
      // and confirm to create tickets. Per §5.4: navigating to /tickets
      // immediately was a UX bug since no tickets exist until confirmation.
      router.push(`/campaigns/${campaignId}?import=${j.data.id}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel panel-pad space-y-3">
      <p className="text-sm text-ink-muted">
        Upload an .xlsx or .csv file. Parsing, header detection, column mapping
        and validation run in a background worker. Each valid row becomes one
        independent ticket after you confirm.
      </p>
      <input
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="block text-sm"
      />
      {err && (
        <div className="text-sm text-danger bg-danger-subtle border border-danger/30 rounded-md px-3 py-2">
          {err}
        </div>
      )}
      <div>
        <button className="btn-primary" onClick={onUpload} disabled={!file || busy}>
          {busy ? "Uploading…" : "Upload and parse"}
        </button>
      </div>
    </div>
  );
}
