import { Worker, type Job } from "bullmq";
import { getRedisConnection } from "./connection";
import { QUEUE_NAMES, ALL_QUEUE_NAMES } from "./names";
import { CONCURRENCY } from "../config";

import { processImport } from "../processors/import.processor";
import { processExtractFile } from "../processors/extract-file.processor";
import { processAnalyze } from "../processors/analyze.processor";
import { processGenerate } from "../processors/generate.processor";
import { processHumanize } from "../processors/humanize.processor";
import { processReview } from "../processors/review.processor";
import { processQa } from "../processors/qa.processor";
import { processRevise } from "../processors/revise.processor";
import { processSend } from "../processors/send.processor";

export interface StartedWorker {
  queue: string;
  close: () => Promise<void>;
}

export async function bootstrap(): Promise<StartedWorker[]> {
  const connection = getRedisConnection();
  const started: StartedWorker[] = [];

  function start<T>(
    queueName: string,
    handler: (job: Job<T>) => Promise<void>,
  ): StartedWorker {
    const worker = new Worker<T>(queueName, handler, {
      connection,
      concurrency: CONCURRENCY,
    });
    worker.on("failed", (job, err) => {
      console.error(`[worker:${queueName}] job ${job?.id} failed:`, err.message);
    });
    return {
      queue: queueName,
      close: () => worker.close(),
    };
  }

  started.push(start(QUEUE_NAMES.imports, processImport));
  started.push(start(QUEUE_NAMES.fileExtraction, processExtractFile));
  started.push(start(QUEUE_NAMES.analysis, processAnalyze));
  started.push(start(QUEUE_NAMES.generation, processGenerate));
  started.push(start(QUEUE_NAMES.humanization, processHumanize));
  started.push(start(QUEUE_NAMES.reviews, processReview));
  started.push(start(QUEUE_NAMES.qa, processQa));
  started.push(start(QUEUE_NAMES.revisions, processRevise));
  started.push(start(QUEUE_NAMES.delivery, processSend));
  // Note: QUEUE_NAMES.drafts exists in the enum for symmetry but is not
  // registered — drafts are created synchronously by the /api/gmail/draft
  // route handler. The queue is kept in the enum so the heartbeat aggregator
  // can report depth (always 0) without special-casing.

  // Heartbeat loop — updates worker_heartbeat every 15s.
  // Also writes queue depth metrics for the dashboard.
  const heartbeatId = setInterval(async () => {
    try {
      const { getServiceSupabase } = await import("@mailpilot/server-core");
      const sb = getServiceSupabase();
      // Aggregate queue depths across all known queues
      let totalDepth = 0;
      let totalActive = 0;
      let totalFailed = 0;
      for (const name of ALL_QUEUE_NAMES) {
        try {
          const { default: BullMQQueue } = await import("bullmq");
          const { getQueue } = await import("./enqueue");
          const q = getQueue(name as QueueName);
          const counts = await q.getJobCounts("waiting", "active", "delayed", "failed");
          totalDepth += (counts.waiting ?? 0) + (counts.delayed ?? 0);
          totalActive += counts.active ?? 0;
          totalFailed += counts.failed ?? 0;
          void BullMQQueue;
        } catch {
          // Redis may be temporarily unavailable — keep heartbeat alive.
        }
      }
      await sb.from("worker_heartbeat").upsert({
        id: "singleton",
        last_beat_at: new Date().toISOString(),
        queue_depth: totalDepth,
        active_jobs: totalActive,
        failed_jobs: totalFailed,
      }, { onConflict: "id" });
    } catch (e) {
      console.warn("[heartbeat] failed:", (e as Error).message);
    }
  }, 15_000);

  // Run an immediate heartbeat so the dashboard sees the worker as online
  // within 1 second of startup.
  setTimeout(() => {
    void (async () => {
      try {
        const { getServiceSupabase } = await import("@mailpilot/server-core");
        const sb = getServiceSupabase();
        await sb.from("worker_heartbeat").upsert({
          id: "singleton",
          last_beat_at: new Date().toISOString(),
        }, { onConflict: "id" });
      } catch (e) {
        console.warn("[heartbeat] initial failed:", (e as Error).message);
      }
    })();
  }, 1000);

  return started;
}

type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
