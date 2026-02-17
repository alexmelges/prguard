import OpenAI from "openai";
import type { VisionEvaluation } from "./types.js";

export function buildVisionPrompt(params: {
  vision: string;
  title: string;
  body: string;
  diffSummary: string;
}): string {
  return [
    "You are evaluating whether a pull request aligns with project vision and rules.",
    "Respond in strict JSON: {\"score\": number, \"aligned\": boolean, \"reasoning\": string, \"recommendation\": \"approve\"|\"review\"|\"reject\" }",
    "Project vision:",
    params.vision,
    "PR title:",
    params.title,
    "PR body:",
    params.body,
    "PR diff summary:",
    params.diffSummary.slice(0, 2000)
  ].join("\n\n");
}

export function normalizeVisionEvaluation(raw: Partial<VisionEvaluation>): VisionEvaluation {
  const score = Math.max(0, Math.min(1, raw.score ?? 0));
  const aligned = raw.aligned ?? score >= 0.6;
  const reasoning = (raw.reasoning ?? "No reasoning provided").trim();
  const recommendation = raw.recommendation ?? (score >= 0.75 ? "approve" : score >= 0.45 ? "review" : "reject");

  return {
    score,
    aligned,
    reasoning,
    recommendation
  };
}

export async function evaluateVision(params: {
  client: OpenAI;
  model: string;
  vision: string;
  title: string;
  body: string;
  diffSummary: string;
}): Promise<VisionEvaluation> {
  const prompt = buildVisionPrompt(params);
  const completion = await params.client.chat.completions.create({
    model: params.model,
    temperature: 0,
    messages: [
      {
        role: "user",
        content: prompt
      }
    ]
  });

  const text = completion.choices[0]?.message?.content ?? "";

  try {
    const parsed = JSON.parse(text) as Partial<VisionEvaluation>;
    return normalizeVisionEvaluation(parsed);
  } catch {
    return {
      score: 0.5,
      aligned: true,
      reasoning: "Vision analysis parser fallback used",
      recommendation: "review"
    };
  }
}
