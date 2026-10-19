import type { Job } from "bullmq";

/**
 * Gemini QA processor — runs one of gemini_qa_structure or gemini_qa_personalization.
 * Identical to the review processor — delegates to it.
 */
export async function processQa(
  job: Job<{ ticketId: string; role: "gemini_qa_structure" | "gemini_qa_personalization"; emailVersionId: string }>,
): Promise<void> {
  const { processReview } = await import("./review.processor");
  await processReview(job as Job<{ ticketId: string; role: any; emailVersionId: string }>);
}
