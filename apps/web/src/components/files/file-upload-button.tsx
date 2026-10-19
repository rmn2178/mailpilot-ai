"use client";

import { useState } from "react";

interface FileUploadButtonProps {
  campaignId: string;
  onUploaded?: () => void;
  label?: string;
}

/**
 * Upload a campaign reference file. POSTs a multipart form to
 * /api/campaigns/[campaignId]/files. The server enqueues an extraction job
 * so the worker can parse text content for the analyze prompt.
 */
export function FileUploadButton({ campaignId, onUploaded, label = "Upload file" }: FileUploadButtonProps) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  async function onUpload(file: File) {
    setBusy(true);
    setErr(null);
    setOkMsg(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/campaigns/${campaignId}/files`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? "Upload failed");
      }
      setOkMsg(`Uploaded "${file.name}". Extraction will run in the background.`);
      onUploaded?.();
      // Per bug #12: refresh the page so the file list updates. The previous
      // version relied on onUploaded which the files page doesn't pass.
      window.location.reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <label className="btn-primary cursor-pointer inline-flex">
        {busy ? "Uploading…" : label}
        <input
          type="file"
          className="hidden"
          accept=".pdf,.docx,.txt,.md,.csv,.xlsx,.xls"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
            e.target.value = "";
          }}
        />
      </label>
      {err && (
        <div className="text-sm text-danger bg-danger-subtle border border-danger/30 rounded-md px-3 py-2">
          {err}
        </div>
      )}
      {okMsg && <div className="text-sm text-success">{okMsg}</div>}
    </div>
  );
}
