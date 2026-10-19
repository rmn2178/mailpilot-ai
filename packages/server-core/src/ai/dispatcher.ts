import type { ProviderRequest, ProviderResponse } from "./provider";
import { callGemini } from "./providers/gemini.provider";
import { callGrok } from "./providers/grok.provider";

/**
 * Dispatcher: routes a request to the configured provider for the slot.
 *
 * The slot → provider mapping is fixed by the spec (§4): four Gemini slots
 * and four Grok slots. We do not allow runtime override of the provider
 * family for a slot.
 */

export async function dispatch(
  req: ProviderRequest,
  credentialSlot: 1 | 2 | 3 | 4 = 1,
): Promise<ProviderResponse> {
  const slot = req.slot;
  if (slot.startsWith("gemini_")) {
    return callGemini(req, credentialSlot);
  }
  if (slot.startsWith("grok_")) {
    return callGrok(req, credentialSlot);
  }
  throw new Error(`Unknown AI slot: ${slot}`);
}
