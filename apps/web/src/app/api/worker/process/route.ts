import { NextRequest, NextResponse } from "next/server";
import {
  runImport,
  runExtractFile,
  runAnalyze,
  runGenerate,
  runHumanize,
  runReview,
  runRevise,
  runQualityGate,
  getNextJobs,
} from "@mailpilot/server-core";
import type { PipelineJob } from "@mailpilot/server-core";
import type { ReviewerRole } from "@mailpilot/shared";

export const dynamic = "force-dynamic";
// Give each step up to 60s (Vercel Pro) or use default 10s (Hobby).
export const maxDuration = 60;

/**
 * Internal pipeline runner — no auth required since it's called server-side
 * only. Guarded by a shared secret so it can't be triggered externally.
 *
 * Each invocation runs ONE pipeline step, then fires off the next step(s)
 * as non-blocking fetch calls so the response returns immediately.
 */
const PIPELINE_SECRET = process.env.TOKEN_ENCRYPTION_KEY ?? "";

export async function POST(req: NextRequest) {
  // Guard: only allow internal calls with the shared secret.
  const authHeader = req.headers.get("x-pipeline-secret");
  if (!authHeader || authHeader !== PIPELINE_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: PipelineJob;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    await runStep(body);
    const nextJobs = await getNextJobsForStep(body);
    // Fire next steps asynchronously — don't await so this response returns fast.
    void dispatchNext(nextJobs, req);
    return NextResponse.json({ ok: true, job: body.job });
  } catch (e) {
    console.error(`[pipeline] step ${body.job} failed:`, (e as Error).message);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

async function runStep(job: PipelineJob): Promise<void> {
  switch (job.job) {
    case "import":
      return runImport(job.importId);
    case "extract_file":
      return runExtractFile(job.fileId);
    case "analyze":
      return runAnalyze(job.ticketId);
    case "generate":
      return runGenerate(job.ticketId);
    case "humanize":
      return runHumanize(job.ticketId);
    case "review":
      return runReview(job.ticketId, job.role as ReviewerRole, job.emailVersionId);
    case "revise":
      return runRevise(job.ticketId);
    case "quality_gate":
      return runQualityGate(job.ticketId);
    case "noop":
      return;
  }
}

async function getNextJobsForStep(job: PipelineJob): Promise<PipelineJob[]> {
  // After these steps, query the DB for what comes next.
  if (
    job.job === "analyze" ||
    job.job === "generate" ||
    job.job === "humanize" ||
    job.job === "review" ||
    job.job === "revise" ||
    job.job === "quality_gate"
  ) {
    return getNextJobs(job.ticketId);
  }
  // import and extract_file don't chain automatically.
  return [];
}

async function dispatchNext(jobs: PipelineJob[], req: NextRequest): Promise<void> {
  if (jobs.length === 0) return;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? `https://${req.headers.get("host")}`;
  const url = `${baseUrl}/api/worker/process`;
  const secret = PIPELINE_SECRET;

  await Promise.allSettled(
    jobs
      .filter((j) => j.job !== "noop")
      .map((j) =>
        fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", "x-pipeline-secret": secret },
          body: JSON.stringify(j),
        }).catch((e) => console.error("[pipeline] dispatch failed:", e.message)),
      ),
  );
}
