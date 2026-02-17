import OpenAI from "openai";

const DEFAULT_MODEL = "text-embedding-3-small";
const MAX_RETRIES = 3;

export function createOpenAIClient(apiKey = process.env.OPENAI_API_KEY): OpenAI {
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required");
  }

  return new OpenAI({ apiKey, maxRetries: MAX_RETRIES });
}

/** Sleep helper for backoff. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Call OpenAI with retries + exponential backoff.
 * Returns null on permanent failure (graceful degradation).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { retries?: number; logger?: { warn: (msg: string) => void } } = {}
): Promise<T | null> {
  const retries = options.retries ?? MAX_RETRIES;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      const isRateLimit = error instanceof OpenAI.RateLimitError;
      const isServer = error instanceof OpenAI.InternalServerError || error instanceof OpenAI.APIConnectionError;
      const isRetryable = isRateLimit || isServer;

      if (!isRetryable || attempt === retries) {
        const msg = error instanceof Error ? error.message : String(error);
        options.logger?.warn(`OpenAI call failed after ${attempt + 1} attempts: ${msg}`);
        return null;
      }

      const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
      const jitter = Math.random() * delay * 0.1;
      await sleep(delay + jitter);
    }
  }
  return null;
}

export async function getEmbedding(
  text: string,
  client: OpenAI,
  model = DEFAULT_MODEL,
  logger?: { warn: (msg: string) => void }
): Promise<number[]> {
  const input = text.trim();
  if (!input) {
    return [];
  }

  const result = await withRetry(
    () => client.embeddings.create({ model, input }),
    { logger }
  );

  if (!result) {
    return [];
  }

  return result.data[0]?.embedding ?? [];
}

export function buildEmbeddingInput(title: string, body: string, diffSummary = ""): string {
  const trimmedDiff = diffSummary.slice(0, 2000);
  return [title.trim(), body.trim(), trimmedDiff.trim()].filter(Boolean).join("\n\n");
}
