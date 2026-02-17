import { describe, expect, it } from "vitest";
import { buildSummaryComment, summaryMarker } from "../src/comment.js";

describe("buildSummaryComment", () => {
  it("renders beautiful comment with emojis", () => {
    const comment = buildSummaryComment({
      duplicates: [{ type: "pr", number: 4, similarity: 0.91, title: "Fix parser too" }],
      vision: { score: 0.8, aligned: true, reasoning: "Aligned", recommendation: "approve" },
      quality: { score: 0.82, recommendation: "approve", reasons: [] },
      bestPRNumber: 5
    });

    expect(comment).toContain("🛡️");
    expect(comment).toContain("🔍");
    expect(comment).toContain("🎯");
    expect(comment).toContain("📊");
    expect(comment).toContain("🏆");
    expect(comment).toContain("91%");
    expect(comment).toContain(summaryMarker());
    expect(comment).toContain("PRGuard");
  });

  it("renders issue-only comment without quality/vision", () => {
    const comment = buildSummaryComment({
      duplicates: [],
      vision: null,
      quality: null,
      bestPRNumber: null
    });

    expect(comment).toContain("No close duplicates");
    expect(comment).not.toContain("Vision");
    expect(comment).not.toContain("Quality");
  });

  it("shows warning notes", () => {
    const comment = buildSummaryComment({
      duplicates: [],
      vision: null,
      quality: { score: 0.3, recommendation: "reject", reasons: ["No test changes detected", "CI is not passing"] },
      bestPRNumber: null
    });

    expect(comment).toContain("⚠️");
    expect(comment).toContain("No test changes");
  });
});
