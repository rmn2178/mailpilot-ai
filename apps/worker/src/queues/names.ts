// Re-export from server-core so the worker and web app share a single source of truth.
import { QUEUE_NAMES } from "@mailpilot/server-core";

export {
  QUEUE_NAMES,
  type QueueName,
  getQueue,
  enqueueIdempotent,
  enqueue,
  DEFAULT_JOB_OPTIONS,
} from "@mailpilot/server-core";

export const ALL_QUEUE_NAMES: readonly string[] = Object.values(QUEUE_NAMES);
