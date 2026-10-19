/**
 * NOTE: This subpath is NOT re-exported from the package root
 * (`packages/shared/src/index.ts`). The manual interfaces below are kept for
 * reference and for tests that construct objects, but the authoritative types
 * are the Zod-inferred ones from `../schemas/index.ts` (re-exported as
 * `Contact`, `Campaign`, `CampaignSettings`, `EmailVersion`, `AiReview`,
 * `ReviewIssue`, `AiSlotConfig` from the package root).
 *
 * Importing `@mailpilot/shared/types` directly in application code is
 * discouraged — use the package root exports instead. The manual interfaces
 * may diverge from the schema-inferred types over time.
 */
export * from "./contact";
export * from "./campaign";
export * from "./ticket";
export * from "./ai";
export * from "./dashboard";
