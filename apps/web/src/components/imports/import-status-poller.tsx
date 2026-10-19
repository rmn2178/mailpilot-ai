"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface ImportStatus {
  id: string;
  status: string;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  duplicate_rows: number;
}

/**
 * Polls /api/imports/[importId] every 2 seconds until parsing completes,
 * then shows a "Confirm import" button that calls POST /api/imports/[importId]
 * with action=confirm to actually create tickets from the valid rows.
 *
 * Per §10 (5th-pass): dropped the `onConfirmed` callback param — it was
 * captured stale by the effect's closure and no caller used it. The
 * component navigates to /tickets?import=… itself after a successful confirm.
 */
export function ImportStatusPoller({ importId }: { importId: string }) {
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const id = setInterval(async () => {
      attempts += 1;
      try {
        const res = await fetch(`/api/imports/${importId}`);
        const j = (await res.json()) as { data?: { import?: ImportStatus; status?: string } };
        if (cancelled) return;
        const imp = j?.data?.import;
        if (!imp) {
          if (attempts > 60) {
            setError("Parsing is taking too long. Check the worker is running.");
            clearInterval(id);
          }
          return;
        }
        setStatus(imp);
        if (imp.status === "import_preview" || imp.status === "import_completed") {
          clearInterval(id);
        }
      } catch {
        // Network blip — keep polling
      }
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [importId]);

  async function confirmImport() {
    setConfirming(true);
    setConfirmError(null);
    try {
      const res = await fetch(`/api/imports/${importId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "confirm" }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? "Confirm failed");
      }
      // Navigate to the tickets view filtered by this import.
      router.push(`/tickets?import=${importId}`);
    } catch (e) {
      setConfirmError((e as Error).message);
    } finally {
      setConfirming(false);
    }
  }

  if (error) {
    return <div className="text-sm text-danger">{error}</div>;
  }
  if (!status) {
    return <div className="text-sm text-ink-muted">Parsing uploaded file…</div>;
  }

  const isParsed = status.status === "import_preview" || status.status === "import_completed";
  const hasValidRows = (status.valid_rows ?? 0) > 0;

  return (
    <div className="space-y-3">
      <div className="text-sm text-ink-muted">
        Status: <span className="capitalize">{status.status.replace("import_", "")}</span>
        {status.total_rows > 0 && (
          <span className="ml-3">
            {status.valid_rows} valid · {status.invalid_rows} invalid · {status.duplicate_rows} duplicates
          </span>
        )}
      </div>
      {isParsed && hasValidRows && (
        <div className="space-y-2">
          <button
            className="btn-primary"
            onClick={confirmImport}
            disabled={confirming}
          >
            {confirming ? "Creating tickets…" : `Confirm import — create ${status.valid_rows} tickets`}
          </button>
          {confirmError && (
            <div className="text-sm text-danger bg-danger-subtle border border-danger/30 rounded-md px-3 py-2">
              {confirmError}
            </div>
          )}
        </div>
      )}
      {isParsed && !hasValidRows && (
        <div className="text-sm text-warn bg-warn-subtle border border-warn/30 rounded-md px-3 py-2">
          No valid rows in this import. Fix the spreadsheet and re-upload.
        </div>
      )}
    </div>
  );
}
