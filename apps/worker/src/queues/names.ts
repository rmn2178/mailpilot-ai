import { QUEUE_NAMES } from "@mailpilot/server-core/queues";

export {
  QUEUE_NAMES,
  type QueueName,
  getQueue,
  enqueueIdempotent,
  enqueue,
  DEFAULT_JOB_OPTIONS,
} from "@mailpilot/server-core/queues";

export const ALL_QUEUE_NAMES: readonly string[] = Object.values(QUEUE_NAMES);
