import { Queue, type JobsOptions } from "bullmq";
import IORedis from "ioredis";
import { loadEnv } from "./env";

/**
 * BullMQ queue helpers shared between the web app (which enqueues jobs from
 * API routes) and the worker (which consumes them).
 *
 * The connection is lazily created on first use. Both processes must use the
 * same Redis URL.
 */

let connection: IORedis | null = null;

export function getRedisConnection(): IORedis {
  if (connection) return connection;
  const env = loadEnv();
  const redisUrl = env.REDIS_URL ?? "redis://localhost:6379";
  connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: true,
    lazyConnect: false,
  });
  connection.on("error", (e) => {
    console.error("[redis] error:", e.message);
  });
  return connection;
}

export const QUEUE_NAMES = {
  imports: "mailpilot-imports",
  fileExtraction: "mailpilot-file-extraction",
  analysis: "mailpilot-analysis",
  generation: "mailpilot-generation",
  humanization: "mailpilot-humanization",
  reviews: "mailpilot-reviews",
  qa: "mailpilot-qa",
  revisions: "mailpilot-revisions",
  drafts: "mailpilot-drafts",
  delivery: "mailpilot-delivery",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

const queues: Partial<Record<QueueName, Queue>> = {};

export function getQueue(name: QueueName): Queue {
  if (queues[name]) return queues[name]!;
  const q = new Queue(name, { connection: getRedisConnection() });
  queues[name] = q;
  return q;
}

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: {
    type: "exponential",
    delay: 2_000,
  },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 24 * 3600, count: 5000 },
};

export async function enqueueIdempotent(
  queue: QueueName,
  jobName: string,
  data: unknown,
  jobId: string,
): Promise<void> {
  const q = getQueue(queue);
  await q.add(jobName, data, { ...DEFAULT_JOB_OPTIONS, jobId });
}

export async function enqueue(
  queue: QueueName,
  jobName: string,
  data: unknown,
): Promise<void> {
  const q = getQueue(queue);
  await q.add(jobName, data, DEFAULT_JOB_OPTIONS);
}
