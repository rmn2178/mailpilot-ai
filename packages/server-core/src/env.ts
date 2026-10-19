import { z } from "zod";

/**
 * Environment validation. Both the web app and the worker import this module
 * at startup and call `loadEnv()`. Missing required vars cause a hard fail
 * with a clear message — never a silent default to a secret.
 */

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),

  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  // Supabase's standard env name is NEXT_PUBLIC_SUPABASE_ANON_KEY. We also
  // accept NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (Supabase's newer name) for
  // compatibility. Either works.
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_STORAGE_BUCKET: z.string().default("mailpilot-private"),

  // DATABASE_URL is optional at boot — the worker needs it for direct psql,
  // but the web app uses the supabase-js client which only needs the URL.
  DATABASE_URL: z.string().optional(),
  // REDIS_URL is only needed by the worker. The web app enqueues jobs via
  // BullMQ but Vercel serverless functions don't maintain persistent Redis
  // connections — the worker runs separately.
  REDIS_URL: z.string().url().default("redis://localhost:6379"),

  // Credentials are optional at boot (some slots may be unconfigured) but
  // validated when their slot is invoked.
  GEMINI_API_KEY_1: z.string().optional(),
  GEMINI_API_KEY_2: z.string().optional(),
  GEMINI_API_KEY_3: z.string().optional(),
  GEMINI_API_KEY_4: z.string().optional(),

  XAI_API_KEY_1: z.string().optional(),
  XAI_API_KEY_2: z.string().optional(),
  XAI_API_KEY_3: z.string().optional(),
  XAI_API_KEY_4: z.string().optional(),

  GEMINI_ANALYZE_MODEL: z.string().default("gemini-1.5-pro"),
  GEMINI_GENERATE_MODEL: z.string().default("gemini-1.5-pro"),
  GEMINI_QA_STRUCTURE_MODEL: z.string().default("gemini-1.5-flash"),
  GEMINI_QA_PERSONALIZATION_MODEL: z.string().default("gemini-1.5-flash"),

  GROK_DEFENSIBILITY_MODEL: z.string().default("grok-2-latest"),
  GROK_HUMAN_TONE_MODEL: z.string().default("grok-2-latest"),
  GROK_CONTENT_FIT_MODEL: z.string().default("grok-2-latest"),
  GROK_DELIVERY_HYGIENE_MODEL: z.string().default("grok-2-latest"),

  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().url().optional(),

  TOKEN_ENCRYPTION_KEY: z.string().min(32),

  WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(4),
  MAX_REVISION_CYCLES: z.coerce.number().int().min(0).max(10).default(3),
  MAX_JOB_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  DEFAULT_TIMEZONE: z.string().default("Asia/Kolkata"),
});

export type AppEnv = z.infer<typeof EnvSchema>;

let cached: AppEnv | null = null;

export function loadEnv(): AppEnv {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(
      `MailPilot AI: invalid environment configuration.\nMissing or invalid:\n${issues}\n\n` +
        `See .env.example for the full list of required variables.`,
    );
  }
  if (!parsed.data.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY && !parsed.data.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error(
      "MailPilot AI: either NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.",
    );
  }
  cached = parsed.data;
  return cached;
}

/**
 * Returns the configured publishable/anon key. We expose a single helper so
 * the rest of the codebase does not care which env name the operator used.
 */
export function getSupabasePublishableKey(): string {
  const env = loadEnv();
  return env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
}

/** Server-only accessor. Throws if called from a client bundle. */
export function requireServerEnv(): AppEnv {
  if (typeof window !== "undefined") {
    throw new Error(
      "Server environment was accessed from a client bundle. " +
        "Secrets must never reach the browser.",
    );
  }
  return loadEnv();
}

export function geminiCredential(slot: 1 | 2 | 3 | 4): string | null {
  const env = loadEnv();
  const map = {
    1: env.GEMINI_API_KEY_1,
    2: env.GEMINI_API_KEY_2,
    3: env.GEMINI_API_KEY_3,
    4: env.GEMINI_API_KEY_4,
  } as const;
  return map[slot] ?? null;
}

export function grokCredential(slot: 1 | 2 | 3 | 4): string | null {
  const env = loadEnv();
  const map = {
    1: env.XAI_API_KEY_1,
    2: env.XAI_API_KEY_2,
    3: env.XAI_API_KEY_3,
    4: env.XAI_API_KEY_4,
  } as const;
  return map[slot] ?? null;
}

export function geminiModelForSlot(slot: string): string {
  const env = loadEnv();
  switch (slot) {
    case "gemini_analyze":
      return env.GEMINI_ANALYZE_MODEL;
    case "gemini_generate":
      return env.GEMINI_GENERATE_MODEL;
    case "gemini_qa_structure":
      return env.GEMINI_QA_STRUCTURE_MODEL;
    case "gemini_qa_personalization":
      return env.GEMINI_QA_PERSONALIZATION_MODEL;
    default:
      throw new Error(`No Gemini model mapping for slot ${slot}`);
  }
}

export function grokModelForSlot(slot: string): string {
  const env = loadEnv();
  switch (slot) {
    case "grok_defensibility":
      return env.GROK_DEFENSIBILITY_MODEL;
    case "grok_human_tone":
      return env.GROK_HUMAN_TONE_MODEL;
    case "grok_content_fit":
      return env.GROK_CONTENT_FIT_MODEL;
    case "grok_delivery_hygiene":
      return env.GROK_DELIVERY_HYGIENE_MODEL;
    default:
      throw new Error(`No Grok model mapping for slot ${slot}`);
  }
}
