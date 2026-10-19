import type { ProviderResponse, ProviderRequest, ProviderError } from "../provider";
import { makeProviderError } from "../provider";
import { grokCredential, grokModelForSlot } from "../../env";
import { withRetry, defaultRetry } from "../retry-policy";
import { acquireSlot, reportProviderCooldown, reportSuccess } from "../quota-manager";

/**
 * Grok provider via the official xAI REST API.
 *
 * Docs: https://docs.x.ai/
 * Endpoint: POST https://api.x.ai/v1/chat/completions
 *
 * Per §3.1: sends `response_format: { type: "json_object" }` so review/QA
 * outputs are valid JSON.
 *
 * Per §3.2: timeout applied via AbortSignal.
 */
export async function callGrok(
  req: ProviderRequest,
  credentialSlot: 1 | 2 | 3 | 4 = 1,
): Promise<ProviderResponse> {
  const apiKey = grokCredential(credentialSlot);
  if (!apiKey) {
    throw makeProviderError("grok", `No xAI API key configured for slot ${credentialSlot}`, {
      code: "NO_CREDENTIAL",
      retryable: false,
    });
  }
  await acquireSlot(req.slot);

  const modelId = grokModelForSlot(req.slot);
  const timeoutMs = req.timeoutMs ?? 60_000;
  const started = Date.now();
  try {
    const result = await withRetry(
      async () => {
        const ctrl = AbortSignal.timeout(timeoutMs);
        const res = await fetch("https://api.x.ai/v1/chat/completions", {
          method: "POST",
          signal: ctrl,
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: modelId,
            temperature: req.temperature ?? 0.4,
            max_tokens: req.maxOutputTokens ?? 4096,
            // JSON mode — per §3.1
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: req.systemPrompt },
              { role: "user", content: req.userPrompt },
            ],
          }),
        });
        if (res.status === 429) {
          const err = makeProviderError("grok", "xAI rate limited (429)", {
            code: "XAI_RATE_LIMITED",
            retryable: true,
            rate_limited: true,
          });
          throw err;
        }
        if (res.status >= 500) {
          const err = makeProviderError(
            "grok",
            `xAI server error ${res.status}`,
            { code: "XAI_SERVER", retryable: true },
          );
          throw err;
        }
        if (!res.ok) {
          const text = await res.text();
          throw makeProviderError("grok", `xAI ${res.status}: ${text}`, {
            code: `XAI_${res.status}`,
            retryable: false,
          });
        }
        return (await res.json()) as {
          choices: Array<{ message: { content: string } }>;
          usage?: { prompt_tokens: number; completion_tokens: number };
        };
      },
      defaultRetry(),
      (err, attempt, delay) => {
        console.warn(
          `[grok:${req.slot}] retry attempt ${attempt + 1} in ${delay}ms — ${err.message}`,
        );
      },
    );

    const text = result.choices?.[0]?.message?.content ?? "";
    const usage = result.usage
      ? {
          tokens_in: result.usage.prompt_tokens ?? 0,
          tokens_out: result.usage.completion_tokens ?? 0,
        }
      : null;
    await reportSuccess(req.slot);
    return {
      text,
      usage,
      model_id: modelId,
      provider: "grok",
      duration_ms: Date.now() - started,
    };
  } catch (e) {
    const err = e as ProviderError;
    if (err.rate_limited) {
      await reportProviderCooldown("grok", 60_000, err.message);
    }
    throw err;
  }
}
