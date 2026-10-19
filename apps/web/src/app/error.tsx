"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="panel panel-pad max-w-lg w-full text-center">
        <h2 className="text-lg font-semibold mb-2">Something went wrong</h2>
        <p className="text-ink-muted text-sm mb-4">
          {error.message || "An unexpected error occurred."}
        </p>
        <div className="flex items-center justify-center gap-2">
          <button className="btn-primary" onClick={reset}>
            Try again
          </button>
          <Link href="/dashboard" className="btn">
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
