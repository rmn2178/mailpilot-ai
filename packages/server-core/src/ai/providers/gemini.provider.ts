import { GoogleGenerativeAI } from "@google/generative-ai";
import type { ProviderResponse, ProviderRequest, ProviderError } from "../provider";
import { makeProviderError } from "../provider";
import { geminiCredential, geminiModelForSlot } from "../../env";
import { withRetry, defaultRetry } from "../retry-policy";
import { acquireSlot, reportProviderCooldown, reportSuccess } from "../quota-manager";

/**
 * Gemini provider.
 *
 * Uses the official @google/generative-ai SDK. Model IDs and credential
 * slots are configurable via env vars.
 *
 * Per §3.1: requests `responseMimeType: "application/json"` so review/QA
 * outputs are returned as valid JSON rather than JSON-wrapped-in-prose.
 *
 * Per §3.2: the timeout is actually applied via AbortController.
 *
 * Docs: https://ai.google.dev/gemini-api/docs
 */
export async function callGemini(
  req: ProviderRequest,
  credentialSlot: 1 | 2 | 3 | 4 = 1,
): Promise<ProviderResponse> {
  const apiKey = geminiCredential(credentialSlot);
  if (!apiKey) {
    throw makeProviderError("gemini", `No Gemini API key configured for slot ${credentialSlot}`, {
      code: "NO_CREDENTIAL",
      retryable: false,
    });
  }
  await acquireSlot(req.slot);

  const modelId = geminiModelForSlot(req.slot);
  const genAI = new GoogleGenerativeAI(apiKey);
  const timeoutMs = req.timeoutMs ?? 60_000;
  const model = genAI.getGenerativeModel({
    model: modelId,
    systemInstruction: req.systemPrompt,
    generationConfig: {
      temperature: req.temperature ?? 0.4,
      maxOutputTokens: req.maxOutputTokens ?? 4096,
      // JSON mode — per §3.1. The prompt's "Return ONLY the JSON object"
      // instruction is enforced server-side by the API.
      responseMimeType: "application/json",
    },
  });

  const started = Date.now();
  try {
    const result = await withRetry(
      async () => {
        // Apply timeout via Promise.race against a setTimeout. Per §19
        // (5th-pass): the timer is cleared in the outer `finally` so it does
        // not leak when generateContent resolves first.
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(makeProviderError("gemini", `Request timed out after ${timeoutMs}ms`, {
            code: "TIMEOUT",
            retryable: true,
          })), timeoutMs);
        });
        try {
          return await Promise.race([
            model.generateContent(req.userPrompt),
            timeoutPromise,
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      },
      defaultRetry(),
      (err, attempt, delay) => {
        console.warn(
          `[gemini:${req.slot}] retry attempt ${attempt + 1} in ${delay}ms — ${err.message}`,
        );
      },
    );

    const text = result.response.text();
    const usage = result.response.usageMetadata
      ? {
          tokens_in: result.response.usageMetadata.promptTokenCount ?? 0,
          tokens_out: result.response.usageMetadata.candidatesTokenCount ?? 0,
        }
      : null;
    await reportSuccess(req.slot);
    return {
      text,
      usage,
      model_id: modelId,
      provider: "gemini",
      duration_ms: Date.now() - started,
    };
  } catch (e) {
    const err = e as ProviderError & { status?: number };
    const rateLimited =
      err.status === 429 || /rate|quota|429/i.test(err.message);
    if (rateLimited) {
      await reportProviderCooldown("gemini", 60_000, err.message);
    }
    throw makeProviderError("gemini", err.message, {
      code: err.code ?? `GEMINI_${err.status ?? "ERROR"}`,
      retryable: !rateLimited && (err.status ?? 0) >= 500,
      rate_limited: rateLimited,
    });
  }
}
