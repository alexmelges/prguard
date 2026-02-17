import OpenAI from "openai";
import { withRetry } from "./embed.js";
import type { CodeReview } from "./types.js";

export function buildReviewPrompt(params: {
  title: string;
  body: string;
  diff: string;
}): string {
  return [
    "You are a senior code reviewer. Analyze this pull request and respond in strict JSON.",
    "JSON schema: {",
    '  "summary": string (2-3 sentences: what does this PR do?),',
    '  "quality_score": number (1-10, code quality: structure, idioms, conventions),',
    '  "correctness_concerns": string[] (bugs, logic errors, missing error handling),',
    '  "scope_assessment": string (does the PR do only what it claims, or sneak in unrelated changes?),',
    '  "verdict": "approve" | "review" | "reject",',
    '  "verdict_reasoning": string (why this verdict)',
    "}",
    "",
    `PR Title: ${params.title}`,
    "",
    `PR Description: ${params.body || "(no description)"}`,
    "",
    "Diff:",
    params.diff.slice(0, 24000)
  ].join("\n");
}

export function normalizeCodeReview(raw: Partial<CodeReview>): CodeReview {
  const qualityScore = Math.max(1, Math.min(10, raw.quality_score ?? 5));
  return {
    summary: raw.summary ?? "No summary available",
    quality_score: qualityScore,
    correctness_concerns: Array.isArray(raw.correctness_concerns) ? raw.correctness_concerns : [],
    scope_assessment: raw.scope_assessment ?? "Unknown",
    verdict: raw.verdict === "approve" || raw.verdict === "reject" ? raw.verdict : "review",
    verdict_reasoning: raw.verdict_reasoning ?? "No reasoning provided"
  };
}

export async function reviewPR(params: {
  client: OpenAI;
  model: string;
  title: string;
  body: string;
  diff: string;
  logger?: { warn: (msg: string) => void };
}): Promise<CodeReview | null> {
  const prompt = buildReviewPrompt(params);
  const result = await withRetry(
    () =>
      params.client.chat.completions.create({
        model: params.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }]
      }),
    { logger: params.logger }
  );

  if (!result) return null;

  const text = result.choices[0]?.message?.content ?? "";
  try {
    return normalizeCodeReview(JSON.parse(text) as Partial<CodeReview>);
  } catch {
    params.logger?.warn("Failed to parse code review response");
    return null;
  }
}

/** Build a cross-PR comparison string from reviews. */
export function buildCrossComparison(
  currentNumber: number,
  currentReview: CodeReview,
  duplicateReviews: Array<{ number: number; review: CodeReview }>
): string {
  if (duplicateReviews.length === 0) return "";

  const all = [
    { number: currentNumber, review: currentReview },
    ...duplicateReviews
  ].sort((a, b) => b.review.quality_score - a.review.quality_score);

  const lines = all.map((pr) => {
    const concerns = pr.review.correctness_concerns.length;
    return `| #${pr.number} | ${pr.review.quality_score}/10 | ${concerns} concern${concerns !== 1 ? "s" : ""} | ${pr.review.verdict} |`;
  });

  const best = all[0];
  return [
    "| PR | Quality | Concerns | Verdict |",
    "|----|---------|----------|---------|",
    ...lines,
    "",
    `**Recommendation:** PR #${best.number} scores highest (${best.review.quality_score}/10).`
  ].join("\n");
}
