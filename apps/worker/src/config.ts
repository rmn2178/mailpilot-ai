import { loadEnv } from "@mailpilot/server-core";

export const config = loadEnv();
export const CONCURRENCY = config.WORKER_CONCURRENCY;
export const MAX_REVISION_CYCLES = config.MAX_REVISION_CYCLES;
export const MAX_JOB_ATTEMPTS = config.MAX_JOB_ATTEMPTS;
