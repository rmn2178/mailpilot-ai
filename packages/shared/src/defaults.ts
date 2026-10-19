/**
 * Default required reviewers per spec §11.
 *
 * Used when a campaign's `required_reviewers` is empty or missing — the
 * "no reviewers required" interpretation would collapse the six-reviewer
 * pipeline, so any falsy/empty value falls back to the full set.
 */
export const DEFAULT_REQUIRED_REVIEWERS: readonly string[] = [
  "grok_defensibility",
  "grok_human_tone",
  "grok_content_fit",
  "grok_delivery_hygiene",
  "gemini_qa_structure",
  "gemini_qa_personalization",
];

/**
 * Resolve the effective required-reviewer list. Returns the provided list
 * only if it is non-empty; otherwise returns DEFAULT_REQUIRED_REVIEWERS.
 *
 * Use this everywhere a campaign's `required_reviewers` is read. The bare
 * `??` operator does not distinguish `[]` from `undefined`, which previously
 * caused the entire six-reviewer pipeline to silently collapse on
 * UI-created campaigns.
 */
export function resolveRequiredReviewers(
  configured: string[] | undefined | null,
): readonly string[] {
  return configured && configured.length > 0 ? configured : DEFAULT_REQUIRED_REVIEWERS;
}
