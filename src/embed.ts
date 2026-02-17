import OpenAI from "openai";

const DEFAULT_MODEL = "text-embedding-3-small";

export function createOpenAIClient(apiKey = process.env.OPENAI_API_KEY): OpenAI {
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required");
  }

  return new OpenAI({ apiKey });
}

export async function getEmbedding(
  text: string,
  client: OpenAI,
  model = DEFAULT_MODEL
): Promise<number[]> {
  const input = text.trim();
  if (!input) {
    return [];
  }

  const response = await client.embeddings.create({
    model,
    input
  });

  return response.data[0]?.embedding ?? [];
}

export function buildEmbeddingInput(title: string, body: string, diffSummary = ""): string {
  const trimmedDiff = diffSummary.slice(0, 2000);
  return [title.trim(), body.trim(), trimmedDiff.trim()].filter(Boolean).join("\n\n");
}
