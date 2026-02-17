import { describe, expect, it } from "vitest";
import { buildReviewPrompt, normalizeCodeReview, buildCrossComparison } from "../src/review.js";
import type { CodeReview } from "../src/types.js";

describe("buildReviewPrompt", () => {
  it("includes title, body, and diff", () => {
    const prompt = buildReviewPrompt({
      title: "Fix auth bug",
      body: "Fixes the login flow",
      diff: "--- src/auth.ts\n+validated = true",
    });
    expect(prompt).toContain("Fix auth bug");
    expect(prompt).toContain("Fixes the login flow");
    expect(prompt).toContain("src/auth.ts");
  });

  it("handles empty body", () => {
    const prompt = buildReviewPrompt({ title: "T", body: "", diff: "d" });
    expect(prompt).toContain("(no description)");
  });

  it("truncates diff to 24000 chars", () => {
    const longDiff = "x".repeat(30000);
    const prompt = buildReviewPrompt({ title: "T", body: "B", diff: longDiff });
    expect(prompt.length).toBeLessThan(25000);
  });
});

describe("normalizeCodeReview", () => {
  it("returns valid review from full input", () => {
    const result = normalizeCodeReview({
      summary: "Adds auth",
      quality_score: 8,
      correctness_concerns: ["missing null check"],
      scope_assessment: "Focused",
      verdict: "approve",
      verdict_reasoning: "Good",
    });
    expect(result.quality_score).toBe(8);
    expect(result.verdict).toBe("approve");
    expect(result.correctness_concerns).toEqual(["missing null check"]);
  });

  it("clamps quality_score", () => {
    expect(normalizeCodeReview({ quality_score: 15 }).quality_score).toBe(10);
    expect(normalizeCodeReview({ quality_score: -5 }).quality_score).toBe(1);
  });

  it("fills defaults for missing fields", () => {
    const result = normalizeCodeReview({});
    expect(result.summary).toBe("No summary available");
    expect(result.quality_score).toBe(5);
    expect(result.correctness_concerns).toEqual([]);
    expect(result.verdict).toBe("review");
  });

  it("defaults invalid verdict to review", () => {
    const result = normalizeCodeReview({ verdict: "maybe" as any });
    expect(result.verdict).toBe("review");
  });
});

describe("buildCrossComparison", () => {
  const base: CodeReview = {
    summary: "s",
    quality_score: 6,
    correctness_concerns: ["a"],
    scope_assessment: "ok",
    verdict: "review",
    verdict_reasoning: "r",
  };

  it("returns empty string when no duplicates", () => {
    expect(buildCrossComparison(1, base, [])).toBe("");
  });

  it("builds comparison table", () => {
    const dup: CodeReview = { ...base, quality_score: 9, correctness_concerns: [] };
    const result = buildCrossComparison(1, base, [{ number: 2, review: dup }]);
    expect(result).toContain("| #1 |");
    expect(result).toContain("| #2 |");
    expect(result).toContain("9/10");
    expect(result).toContain("PR #2 scores highest");
  });

  it("picks current PR when it scores highest", () => {
    const dup: CodeReview = { ...base, quality_score: 3 };
    const result = buildCrossComparison(1, base, [{ number: 2, review: dup }]);
    expect(result).toContain("PR #1 scores highest");
  });
});
