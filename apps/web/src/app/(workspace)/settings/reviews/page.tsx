import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ReviewThresholdsPage() {
  await requireAuth();
  return (
    <div className="p-6 max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Review thresholds</h1>
      <p className="text-sm text-ink-muted">
        Per-reviewer minimum scores and required-reviewer lists are configured
        per-campaign in Campaign settings → Approval.
      </p>
      <div className="panel panel-pad text-sm">
        Global review policy defaults are managed here in a production deployment
        (e.g. mandatory reviewers, blocking severity floor).
      </div>
    </div>
  );
}
